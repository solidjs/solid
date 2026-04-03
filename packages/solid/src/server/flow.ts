import { children } from "./core.js";
import {
  createMemo,
  mapArray,
  repeat,
  createErrorBoundary,
  getOwner,
  getNextChildId
} from "./signals.js";
import { createLoadingBoundary } from "./hydration.js";
import type { Accessor } from "./signals.js";
import type { JSX } from "../jsx.js";

type NonZeroParams<T extends (...args: any[]) => any> = Parameters<T>["length"] extends 0
  ? never
  : T;
type ConditionalRenderCallback<T> = (item: Accessor<NonNullable<T>>) => JSX.Element;
type ConditionalRenderChildren<
  T,
  F extends ConditionalRenderCallback<T> = ConditionalRenderCallback<T>
> = JSX.Element | NonZeroParams<F>;

/**
 * Creates a list of elements from a list
 *
 * @description https://docs.solidjs.com/reference/components/for
 */
export function For<T extends readonly any[], U extends JSX.Element>(props: {
  each: T | undefined | null | false;
  fallback?: JSX.Element;
  keyed?: boolean | ((item: T[number]) => any);
  children: (item: Accessor<T[number]>, index: Accessor<number>) => U;
}) {
  const options =
    "fallback" in props
      ? { keyed: props.keyed, fallback: () => props.fallback }
      : { keyed: props.keyed };
  return mapArray(() => props.each, props.children, options) as unknown as JSX.Element;
}

/**
 * Creates a list elements from a count
 *
 * @description https://docs.solidjs.com/reference/components/repeat
 */
export function Repeat<T extends JSX.Element>(props: {
  count: number;
  from?: number | undefined;
  fallback?: JSX.Element;
  children: ((index: number) => T) | T;
}) {
  const options: { fallback?: Accessor<JSX.Element>; from?: Accessor<number | undefined> } =
    "fallback" in props ? { fallback: () => props.fallback } : {};
  options.from = () => props.from;
  return repeat(
    () => props.count,
    index => (typeof props.children === "function" ? props.children(index) : props.children),
    options
  ) as unknown as JSX.Element;
}

/**
 * Conditionally render its children or an optional fallback component
 * @description https://docs.solidjs.com/reference/components/show
 */
export function Show<T, F extends ConditionalRenderCallback<T>>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  fallback?: JSX.Element;
  children: ConditionalRenderChildren<T, F>;
}): JSX.Element {
  const o = getOwner();
  if (o?.id != null) {
    getNextChildId(o); // match client's conditionValue memo
    if (!props.keyed) getNextChildId(o); // match client's condition memo (non-keyed only)
  }
  return createMemo(() => {
    const when = props.when;
    if (when) {
      const child = props.children;
      if (typeof child === "function" && child.length > 0) {
        return (child as any)(() => when as NonNullable<T>);
      }
      return child as JSX.Element;
    }
    return props.fallback as JSX.Element;
  }) as unknown as JSX.Element;
}

type EvalConditions = readonly [number, unknown, MatchProps<unknown>];

/**
 * Switches between content based on mutually exclusive conditions
 * @description https://docs.solidjs.com/reference/components/switch-and-match
 */
export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }): JSX.Element {
  const chs = children(() => props.children);
  const o = getOwner();
  if (o?.id != null) getNextChildId(o); // advance ID counter

  return createMemo(() => {
    let conds: MatchProps<unknown> | MatchProps<unknown>[] = chs() as any;
    if (!Array.isArray(conds)) conds = [conds];

    for (let i = 0; i < conds.length; i++) {
      const w = conds[i].when;
      if (w) {
        const c = conds[i].children;
        return typeof c === "function" && c.length > 0 ? (c as any)(() => w) : c;
      }
    }
    return props.fallback;
  }) as unknown as JSX.Element;
}

export type MatchProps<T, F extends ConditionalRenderCallback<T> = ConditionalRenderCallback<T>> = {
  when: T | undefined | null | false;
  keyed?: boolean;
  children: ConditionalRenderChildren<T, F>;
};

/**
 * Selects a content based on condition when inside a `<Switch>` control flow
 * @description https://docs.solidjs.com/reference/components/switch-and-match
 */
export function Match<T, F extends ConditionalRenderCallback<T>>(props: MatchProps<T, F>) {
  return props as unknown as JSX.Element;
}

/**
 * Catches uncaught errors inside components and renders a fallback content
 * @description https://docs.solidjs.com/reference/components/error-boundary
 */
export function Errored(props: {
  fallback: JSX.Element | ((err: any, reset: () => void) => JSX.Element);
  children: JSX.Element;
}): JSX.Element {
  return createErrorBoundary(
    () => props.children,
    (err, reset) => {
      const f = props.fallback;
      return typeof f === "function" && f.length ? f(err, reset) : f;
    }
  ) as unknown as JSX.Element;
}

/**
 * Tracks all resources inside a component and renders a fallback until they are all resolved
 * @description https://docs.solidjs.com/reference/components/suspense
 */
export function Loading(props: {
  fallback?: JSX.Element;
  on?: any;
  children: JSX.Element;
}): JSX.Element {
  return createLoadingBoundary(
    () => props.children,
    () => props.fallback
  ) as unknown as JSX.Element;
}
