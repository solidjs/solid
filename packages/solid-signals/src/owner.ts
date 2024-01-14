/**
 * Owner tracking is used to enable nested tracking scopes with automatic cleanup.
 * We also use owners to also keep track of which error handling context we are in.
 *
 * If you write the following
 *
 *   const a = createOwner(() => {
 *     const b = createOwner(() => {});
 *
 *     const c = createOwner(() => {
 *       const d = createOwner(() => {});
 *     });
 *
 *     const e = createOwner(() => {});
 *   });
 *
 * The owner tree will look like this:
 *
 *    a
 *   /|\
 *  b-c-e
 *    |
 *    d
 *
 * Following the _nextSibling pointers of each owner will first give you its children, and then its siblings (in reverse).
 * a -> e -> c -> d -> b
 *
 * Note that the owner tree is largely orthogonal to the reactivity tree, and is much closer to the component tree.
 */

import { STATE_CLEAN, STATE_DISPOSED } from './constants';
import type { Computation } from './core';
import { ContextNotFoundError, NoOwnerError, type ErrorHandler } from './error';
import { isUndefined } from './utils';

export type ContextRecord = Record<string | symbol, unknown>;

export interface Disposable {
  (): void;
}

let currentOwner: Owner | null = null,
  defaultContext = {};

/**
 * Returns the currently executing parent owner.
 */
export function getOwner(): Owner | null {
  return currentOwner;
}

export function setOwner(owner: Owner | null): Owner | null {
  const out = currentOwner;
  currentOwner = owner;
  return out;
}

export class Owner {
  // We flatten the owner tree into a linked list so that we don't need a pointer to .firstChild
  // However, the children are actually added in reverse creation order
  // See comment at the top of the file for an example of the _nextSibling traversal
  _parent: Owner | null = null;
  _nextSibling: Owner | null = null;
  _prevSibling: Owner | null = null;

  _state: number = STATE_CLEAN;

  _disposal: Disposable | Disposable[] | null = null;
  _context: ContextRecord = defaultContext;
  _handlers: ErrorHandler[] | null = null;

  constructor(signal = false) {
    if (currentOwner && !signal) currentOwner.append(this);
  }

  append(child: Owner): void {
    child._parent = this;
    child._prevSibling = this;

    if (this._nextSibling) this._nextSibling._prevSibling = child;
    child._nextSibling = this._nextSibling;
    this._nextSibling = child;

    if (child._context !== this._context) {
      child._context = { ...this._context, ...child._context };
    }

    if (this._handlers) {
      child._handlers = !child._handlers
        ? this._handlers
        : [...child._handlers, ...this._handlers];
    }
  }

  dispose(this: Owner, self = true): void {
    if (this._state === STATE_DISPOSED) return;

    let head = self ? this._prevSibling || this._parent : this,
      current = this._nextSibling,
      next: Computation | null = null;

    while (current && current._parent === this) {
      current.dispose(true);
      current._disposeNode();
      next = current._nextSibling as Computation | null;
      current._nextSibling = null;
      current = next;
    }

    if (self) this._disposeNode();
    if (current) current._prevSibling = !self ? this : this._prevSibling;
    if (head) head._nextSibling = current;
  }

  _disposeNode(): void {
    if (this._prevSibling) this._prevSibling._nextSibling = null;
    this._parent = null;
    this._prevSibling = null;
    this._context = defaultContext;
    this._handlers = null;
    this._state = STATE_DISPOSED;
    this.emptyDisposal();
  }

  emptyDisposal(): void {
    if (!this._disposal) return;

    if (Array.isArray(this._disposal)) {
      for (let i = 0; i < this._disposal.length; i++) {
        const callable = this._disposal[i];
        callable.call(callable);
      }
    } else {
      this._disposal.call(this._disposal);
    }

    this._disposal = null;
  }

  handleError(error: unknown): void {
    if (!this._handlers) throw error;

    let i = 0,
      len = this._handlers.length;

    for (i = 0; i < len; i++) {
      try {
        this._handlers[i](error);
        break; // error was handled.
      } catch (e) {
        error = e;
      }
    }

    // Error was not handled as we exhausted all handlers.
    if (i === len) throw error;
  }
}

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T | undefined;
}

/**
 * Context provides a form of dependency injection. It is used to save from needing to pass
 * data as props through intermediate components. This function creates a new context object
 * that can be used with `getContext` and `setContext`.
 *
 * A default value can be provided here which will be used when a specific value is not provided
 * via a `setContext` call.
 */
export function createContext<T>(
  defaultValue?: T,
  description?: string,
): Context<T> {
  return { id: Symbol(description), defaultValue };
}

/**
 * Attempts to get a context value for the given key.
 *
 * @throws `NoOwnerError` if there's no owner at the time of call.
 * @throws `ContextNotFoundError` if a context value has not been set yet.
 */
export function getContext<T>(
  context: Context<T>,
  owner: Owner | null = currentOwner,
): T {
  if (!owner) {
    throw new NoOwnerError();
  }

  const value = hasContext(context, owner)
    ? (owner._context[context.id] as T)
    : context.defaultValue;

  if (isUndefined(value)) {
    throw new ContextNotFoundError();
  }

  return value;
}

/**
 * Attempts to set a context value on the parent scope with the given key.
 *
 * @throws `NoOwnerError` if there's no owner at the time of call.
 */
export function setContext<T>(
  context: Context<T>,
  value?: T,
  owner: Owner | null = currentOwner,
) {
  if (!owner) {
    throw new NoOwnerError();
  }

  // We're creating a new object to avoid child context values being exposed to parent owners. If
  // we don't do this, everything will be a singleton and all hell will break lose.
  owner._context = {
    ...owner._context,
    [context.id]: isUndefined(value) ? context.defaultValue : value,
  };
}

/**
 * Whether the given context is currently defined.
 */
export function hasContext(
  context: Context<any>,
  owner: Owner | null = currentOwner,
): boolean {
  return !isUndefined(owner?._context[context.id]);
}

/**
 * Runs the given function when the parent owner computation is being disposed.
 */
export function onCleanup(disposable: Disposable): void {
  if (!currentOwner) return;

  const node = currentOwner;

  if (!node._disposal) {
    node._disposal = disposable;
  } else if (Array.isArray(node._disposal)) {
    node._disposal.push(disposable);
  } else {
    node._disposal = [node._disposal, disposable];
  }
}
