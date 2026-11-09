import { ContextNotFoundError, NoOwnerError } from "./error.js";
import { getOwner } from "./owner.js";
import type { Owner } from "./types.js";

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T | undefined;
}

export type ContextRecord = Record<string | symbol, unknown>;

/**
 * Context provides a form of dependency injection. It is used to save from needing to pass
 * data as props through intermediate components. This function creates a new context object
 * that can be used with `getContext` and `setContext`.
 *
 * A default value can be provided here which will be used when a specific value is not provided
 * via a `setContext` call.
 */
export function createContext<T>(defaultValue?: T, description?: string): Context<T> {
  // Dev: an explicit `undefined` default is still no default (`undefined`
  // means "not provided"); remembered so a failed read can say so (#4181).
  if (__DEV__ && arguments.length && defaultValue === undefined)
    return { id: Symbol(description), defaultValue, _undefinedDefault: true } as Context<T>;
  return { id: Symbol(description), defaultValue };
}

/**
 * Low-level owner-targeted context read. The user-facing read API is
 * `useContext` (in `solid-js`), which wraps this primitive. Exposed here for
 * cross-package wiring (e.g. hydration-aware context plumbing).
 *
 * @throws `NoOwnerError` in dev if there's no owner at the time of call; production
 *   reads the default instead (see below).
 * @throws `ContextNotFoundError` if a context value has not been set yet.
 *
 * @internal
 */
export function getContext<T>(context: Context<T>, owner: Owner | null = getOwner()): T {
  // `undefined` alone means unset — a provided `null` is a value (no `??`).
  let value: T | undefined;
  if (owner) value = owner._context[context.id] as T | undefined;
  // Dev keeps the loud error. Production reads with no owner as if under an
  // empty root: the default, else `ContextNotFoundError`. That is what dev
  // gives a component created outside any owner, since dev `createComponent`
  // wraps every component in a root; prod `createComponent` does not.
  else if (__DEV__) throw new NoOwnerError();
  if (value === undefined) value = context.defaultValue;

  if (value === undefined) {
    // Dev names the context and why it has no value: no provider, or a
    // provider that passed `undefined` (the key is set, to `undefined`).
    throw __DEV__
      ? new ContextNotFoundError(context, context.id in owner!._context)
      : new ContextNotFoundError();
  }

  return value;
}

/**
 * Low-level owner-targeted context write. The user-facing API is
 * `createContext` (in `solid-js`); its provider component wraps this
 * primitive. Exposed here for cross-package wiring.
 *
 * @throws `NoOwnerError` if there's no owner at the time of call.
 *
 * @internal
 */
export function setContext<T>(context: Context<T>, value?: T, owner: Owner | null = getOwner()) {
  if (!owner) {
    throw new NoOwnerError();
  }

  // We're creating a new object to avoid child context values being exposed to parent owners. If
  // we don't do this, everything will be a singleton and all hell will break lose.
  owner._context = {
    ...owner._context,
    [context.id]: value === undefined ? context.defaultValue : value
  };
}
