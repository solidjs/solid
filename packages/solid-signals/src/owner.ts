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
import { type ErrorHandler } from './error';

export type ContextRecord = Record<string | symbol, unknown>;

export interface Disposable {
  (): void;
}

let currentOwner: Owner | null = null;

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
  _context: null | ContextRecord = null;
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

    if (this._handlers) {
      child._handlers = !child._handlers
        ? this._handlers
        : [...child._handlers, ...this._handlers];
    }
  }

  dispose(this: Owner, self = true): void {
    if (this._state === STATE_DISPOSED) return;

    let current = this._nextSibling as Computation | null;

    while (current && current._parent === this) {
      current.dispose(true);

      current = current._nextSibling as Computation;
    }

    const head = self ? this._prevSibling : this;
    if (self) this._disposeNode();
    else if (current) current._prevSibling = this._prevSibling;
    if (head) head._nextSibling = current;
  }

  _disposeNode(): void {
    if (this._nextSibling) this._nextSibling._prevSibling = this._prevSibling;
    this._parent = null;
    this._prevSibling = null;
    this._context = null;
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
