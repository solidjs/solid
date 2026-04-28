import {
  createMemo,
  createRoot,
  setContext,
  getContext,
  flatten,
  getOwner,
  runWithOwner
} from "./signals.js";
import type { Accessor, EffectOptions } from "./signals.js";
import type { JSX } from "../jsx.js";
import type { FlowComponent, FlowProps } from "./component.js";

export const $DEVCOMP = Symbol("solid-dev-component");

// Magic type that when used at sites where generic types are inferred from, will prevent those sites from being involved in the inference.
export type NoInfer<T extends any> = [T][T extends any ? 0 : never];

export type ContextProviderComponent<T> = FlowComponent<{ value: T }>;

// Context API
export interface Context<T> extends ContextProviderComponent<T> {
  id: symbol;
  defaultValue: T | undefined;
}

/**
 * Creates a Context to share state with descendants of a Provider.
 *
 * - `createContext<T>()` — default-less. `useContext` throws
 *   `ContextNotFoundError` outside any Provider. Use this for any context
 *   carrying reactive state.
 * - `createContext<T>(defaultValue)` — default form. `useContext` falls back
 *   to `defaultValue` outside a Provider. Reserved for primitive fallbacks
 *   (theme, locale, frozen config).
 *
 * @param defaultValue optional default; only meaningful for primitive fallbacks
 * @param options allows to set a name in dev mode for debugging purposes
 */
export function createContext<T>(defaultValue?: T, options?: EffectOptions): Context<T> {
  const id = Symbol((options && options.name) || "");
  function provider(props: FlowProps<{ value: unknown }>) {
    return createRoot(() => {
      setContext(provider, props.value);
      return children(() => props.children);
    });
  }
  provider.id = id;
  provider.defaultValue = defaultValue;
  return provider as unknown as Context<T>;
}

/**
 * Reads the current value of a context. Throws `ContextNotFoundError` if no
 * Provider is mounted and the context was created without a default.
 */
export function useContext<T>(context: Context<T>): T {
  return getContext(context);
}

export type ResolvedJSXElement = Exclude<JSX.Element, JSX.ArrayElement>;
export type ResolvedChildren = ResolvedJSXElement | ResolvedJSXElement[];
export type ChildrenReturn = Accessor<ResolvedChildren> & { toArray: () => ResolvedJSXElement[] };

/**
 * Resolves child elements to help interact with children
 * @param fn an accessor for the children
 * @returns a accessor of the same children, but resolved
 */
export function children(fn: Accessor<JSX.Element>): ChildrenReturn {
  const c = createMemo(fn, { lazy: true });
  const memo = createMemo(() => flatten(c()), {
    lazy: true
  }) as unknown as ChildrenReturn;
  memo.toArray = () => {
    const v = memo();
    return Array.isArray(v) ? v : v != null ? [v] : [];
  };
  return memo;
}

/**
 * Pass-through for SSR dynamic expressions.
 * On the client, insert() render effects are transparent (0 owner slots),
 * so the server doesn't need to create owners for these either.
 */
export function ssrRunInScope(fn: () => any): () => any;
export function ssrRunInScope(array: (() => any)[]): (() => any)[];
export function ssrRunInScope(fn: (() => any) | (() => any)[]): (() => any) | (() => any)[] {
  const owner = getOwner();
  if (!owner) return fn;
  return Array.isArray(fn)
    ? fn.map(hole => () => runWithOwner(owner, hole))
    : () => runWithOwner(owner, fn);
}
