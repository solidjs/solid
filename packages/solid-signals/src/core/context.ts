import { getOwner } from "./core.js";
import type { Owner } from "./types.js";
import { ContextNotFoundError, NoOwnerError } from "./error.js";

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
  return { id: Symbol(description), defaultValue };
}

/**
 * Attempts to get a context value for the given key.
 *
 * @throws `NoOwnerError` if there's no owner at the time of call.
 * @throws `ContextNotFoundError` if a context value has not been set yet.
 */
export function getContext<T>(context: Context<T>, owner: Owner | null = getOwner()): T {
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
export function setContext<T>(context: Context<T>, value?: T, owner: Owner | null = getOwner()) {
  if (!owner) {
    throw new NoOwnerError();
  }

  // We're creating a new object to avoid child context values being exposed to parent owners. If
  // we don't do this, everything will be a singleton and all hell will break lose.
  owner._context = {
    ...owner._context,
    [context.id]: isUndefined(value) ? context.defaultValue : value
  };
}

function hasContext(context: Context<any>, owner: Owner): boolean {
  return !isUndefined(owner?._context[context.id]);
}

function isUndefined(value: any): value is undefined {
  return typeof value === "undefined";
}
