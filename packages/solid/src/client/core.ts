import {
  createMemo,
  createRoot,
  getOwner,
  untrack,
  setContext,
  getContext,
  createEffect,
  flatten
} from "@solidjs/signals";
import type { Accessor, Owner, EffectOptions } from "@solidjs/signals";
import type { JSX } from "../jsx.js";
import { FlowComponent, FlowProps } from "./component.js";

// replaced during build
export const IS_DEV = "_SOLID_DEV_" as string | boolean;
export const $DEVCOMP = Symbol(IS_DEV ? "COMPONENT_DEV" : 0);

/**
 * Runs an effect only after initial render on mount
 * @param fn an effect that should run only once on mount
 *
 * @description https://docs.solidjs.com/reference/lifecycle/on-mount
 */
export function onMount(fn: () => void) {
  createEffect(() => null, fn);
}

// Magic type that when used at sites where generic types are inferred from, will prevent those sites from being involved in the inference.
// https://github.com/microsoft/TypeScript/issues/14829
// TypeScript Discord conversation: https://discord.com/channels/508357248330760243/508357248330760249/911266491024949328
export type NoInfer<T extends any> = [T][T extends any ? 0 : never];

export type ContextProviderComponent<T> = FlowComponent<{ value: T }>;

// Context API
export interface Context<T> extends ContextProviderComponent<T> {
  id: symbol;
  defaultValue: T;
}

/**
 * Creates a Context to handle a state scoped for the children of a component
 * ```typescript
 * interface Context<T> {
 *   id: symbol;
 *   Provider: FlowComponent<{ value: T }>;
 *   defaultValue: T;
 * }
 * export function createContext<T>(
 *   defaultValue?: T,
 *   options?: { name?: string }
 * ): Context<T | undefined>;
 * ```
 * @param defaultValue optional default to inject into context
 * @param options allows to set a name in dev mode for debugging purposes
 * @returns The context that contains the Provider Component and that can be used with `useContext`
 *
 * @description https://docs.solidjs.com/reference/component-apis/create-context
 */
export function createContext<T>(
  defaultValue?: undefined,
  options?: EffectOptions
): Context<T | undefined>;
export function createContext<T>(defaultValue: T, options?: EffectOptions): Context<T>;
export function createContext<T>(
  defaultValue?: T,
  options?: EffectOptions
): Context<T | undefined> {
  const id = Symbol((options && options.name) || "");
  function provider(props: FlowProps<{ value: unknown }>) {
    return createRoot(() => {
      setContext(provider, props.value);
      return children(() => props.children);
    });
  }
  provider.id = id;
  provider.defaultValue = defaultValue;
  return provider as unknown as Context<T | undefined>;
}

/**
 * Uses a context to receive a scoped state from a parent's Context.Provider
 *
 * @param context Context object made by `createContext`
 * @returns the current or `defaultValue`, if present
 *
 * @description https://docs.solidjs.com/reference/component-apis/use-context
 */
export function useContext<T>(context: Context<T>): T {
  return getContext(context);
}

export type ResolvedJSXElement = Exclude<JSX.Element, JSX.ArrayElement>;
export type ResolvedChildren = ResolvedJSXElement | ResolvedJSXElement[];
export type ChildrenReturn = Accessor<ResolvedChildren> & { toArray: () => ResolvedJSXElement[] };

/**
 * Resolves child elements to help interact with children
 *
 * @param fn an accessor for the children
 * @returns a accessor of the same children, but resolved
 *
 * @description https://docs.solidjs.com/reference/component-apis/children
 */
export function children(fn: Accessor<JSX.Element>): ChildrenReturn {
  const children = createMemo(fn);
  const memo = IS_DEV
    ? createMemo(() => flatten(children()), undefined, { name: "children" })
    : createMemo(() => flatten(children()));
  (memo as ChildrenReturn).toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo as ChildrenReturn;
}

// Dev
export function devComponent<P, V>(Comp: (props: P) => V, props: P): V {
  return createRoot(() => {
    const owner: any = getOwner();
    owner._props = props;
    owner._name = Comp.name;
    owner._component = Comp;
    return untrack(() => {
      Object.assign(Comp, { [$DEVCOMP]: true });
      return Comp(props);
    });
  });
}

interface SourceMapValue {
  value: unknown;
  name?: string;
  graph?: Owner;
}
export function registerGraph(value: SourceMapValue): void {
  const owner: any = getOwner();
  if (!owner) return;
  if (owner.sourceMap) owner.sourceMap.push(value);
  else owner.sourceMap = [value];
  value.graph = owner;
}
