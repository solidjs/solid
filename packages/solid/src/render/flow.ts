import {
  createMemo,
  untrack,
  createSignal,
  onError,
  children,
  Accessor,
  Setter,
  onCleanup,
  MemoOptions
} from "../reactive/signal.js";
import { mapArray, indexArray } from "../reactive/array.js";
import { sharedConfig } from "./hydration.js";
import type { JSX } from "../jsx.js";

/**
 * creates a list elements from a list
 *
 * it receives a map function as its child that receives a list element and an accessor with the index and returns a JSX-Element; if the list is empty, an optional fallback is returned:
 * ```typescript
 * <For each={items} fallback={<div>No items</div>}>
 *   {(item, index) => <div data-index={index()}>{item}</div>}
 * </For>
 * ```
 * If you have a list with fixed indices and changing values, consider using `<Index>` instead.
 *
 * @description https://www.solidjs.com/docs/latest/api#%3Cfor%3E
 */
export function For<T extends readonly any[], U extends JSX.Element>(props: {
  each: T | undefined | null | false;
  fallback?: JSX.Element;
  children: (item: T[number], index: Accessor<number>) => U;
}): Accessor<U[]> {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return "_SOLID_DEV_"
    ? createMemo(
        mapArray(() => props.each, props.children, fallback || undefined),
        undefined,
        { name: "value" }
      )
    : createMemo(mapArray(() => props.each, props.children, fallback || undefined));
}

/**
 * Non-keyed iteration over a list creating elements from its items
 *
 * To be used if you have a list with fixed indices, but changing values.
 * ```typescript
 * <Index each={items} fallback={<div>No items</div>}>
 *   {(item, index) => <div data-index={index}>{item()}</div>}
 * </Index>
 * ```
 * If you have a list with changing indices, better use `<For>`.
 *
 * @description https://www.solidjs.com/docs/latest/api#%3Cindex%3E
 */
export function Index<T extends readonly any[], U extends JSX.Element>(props: {
  each: T | undefined | null | false;
  fallback?: JSX.Element;
  children: (item: Accessor<T[number]>, index: number) => U;
}): Accessor<U[]> {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return "_SOLID_DEV_"
    ? createMemo(
        indexArray(() => props.each, props.children, fallback || undefined),
        undefined,
        { name: "value" }
      )
    : createMemo(indexArray(() => props.each, props.children, fallback || undefined));
}

/**
 * Conditionally render its children or an optional fallback component
 * @description https://www.solidjs.com/docs/latest/api#%3Cshow%3E
 */
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed: true;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: NonNullable<T>) => JSX.Element);
}): () => JSX.Element;
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  fallback?: JSX.Element;
  children: JSX.Element;
}): () => JSX.Element;
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: NonNullable<T>) => JSX.Element);
}) {
  let strictEqual = false;
  const keyed = props.keyed;
  const condition = createMemo<T | undefined | null | boolean>(
    () => props.when,
    undefined,
    "_SOLID_DEV_"
      ? {
          equals: (a, b) => (strictEqual ? a === b : !a === !b),
          name: "condition"
        }
      : { equals: (a, b) => (strictEqual ? a === b : !a === !b) }
  );
  return createMemo(
    () => {
      const c = condition();
      if (c) {
        const child = props.children;
        const fn = typeof child === "function" && child.length > 0;
        strictEqual = keyed || fn;
        return fn ? untrack(() => (child as any)(c as T)) : child;
      }
      return props.fallback;
    },
    undefined,
    "_SOLID_DEV_" ? { name: "value" } : undefined
  ) as () => JSX.Element;
}

type EvalConditions = [number, unknown?, MatchProps<unknown>?];

/**
 * switches between content based on mutually exclusive conditions
 * ```typescript
 * <Switch fallback={<FourOhFour />}>
 *   <Match when={state.route === 'home'}>
 *     <Home />
 *   </Match>
 *   <Match when={state.route === 'settings'}>
 *     <Settings />
 *   </Match>
 * </Switch>
 * ```
 * @description https://www.solidjs.com/docs/latest/api#%3Cswitch%3E%2F%3Cmatch%3E
 */
export function Switch(props: {
  fallback?: JSX.Element;
  children: JSX.Element;
}): Accessor<JSX.Element> {
  let strictEqual = false;
  let keyed = false;
  const equals: MemoOptions<EvalConditions>["equals"] = (a, b) =>
    a[0] === b[0] && (strictEqual ? a[1] === b[1] : !a[1] === !b[1]) && a[2] === b[2];
  const conditions = children(() => props.children) as unknown as () => MatchProps<unknown>[],
    evalConditions = createMemo(
      (): EvalConditions => {
        let conds = conditions();
        if (!Array.isArray(conds)) conds = [conds];
        for (let i = 0; i < conds.length; i++) {
          const c = conds[i].when;
          if (c) {
            keyed = !!conds[i].keyed;
            return [i, c, conds[i]];
          }
        }
        return [-1];
      },
      undefined,
      "_SOLID_DEV_" ? { equals, name: "eval conditions" } : { equals }
    );
  return createMemo(
    () => {
      const [index, when, cond] = evalConditions();
      if (index < 0) return props.fallback;
      const c = cond!.children;
      const fn = typeof c === "function" && c.length > 0;
      strictEqual = keyed || fn;
      return fn ? untrack(() => (c as any)(when)) : c;
    },
    undefined,
    "_SOLID_DEV_" ? { name: "value" } : undefined
  );
}

export type MatchProps<T> = {
  when: T | undefined | null | false;
  keyed?: boolean;
  children: JSX.Element | ((item: NonNullable<T>) => JSX.Element);
};
/**
 * selects a content based on condition when inside a `<Switch>` control flow
 * ```typescript
 * <Match when={condition()}>
 *   <Content/>
 * </Match>
 * ```
 * @description https://www.solidjs.com/docs/latest/api#%3Cswitch%3E%2F%3Cmatch%3E
 */
export function Match<T>(props: {
  when: T | undefined | null | false;
  keyed: true;
  children: JSX.Element | ((item: NonNullable<T>) => JSX.Element);
}): JSX.Element;
export function Match<T>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  children: JSX.Element;
}): JSX.Element;
export function Match<T>(props: MatchProps<T>) {
  return props as unknown as JSX.Element;
}

let Errors: Set<Setter<any>>;
export function resetErrorBoundaries() {
  Errors && [...Errors].forEach(fn => fn());
}
/**
 * catches uncaught errors inside components and renders a fallback content
 *
 * Also supports a callback form that passes the error and a reset function:
 * ```typescript
 * <ErrorBoundary fallback={
 *   (err, reset) => <div onClick={reset}>Error: {err.toString()}</div>
 * }>
 *   <MyComp />
 * </ErrorBoundary>
 * ```
 * Errors thrown from the fallback can be caught by a parent ErrorBoundary
 *
 * @description https://www.solidjs.com/docs/latest/api#%3Cerrorboundary%3E
 */
export function ErrorBoundary(props: {
  fallback: JSX.Element | ((err: any, reset: () => void) => JSX.Element);
  children: JSX.Element;
}): Accessor<JSX.Element> {
  let err;
  let v;
  if (
    sharedConfig!.context &&
    sharedConfig!.load &&
    (v = sharedConfig.load(sharedConfig.context.id + sharedConfig.context.count))
  )
    err = v[0];
  const [errored, setErrored] = createSignal<any>(
    err,
    "_SOLID_DEV_" ? { name: "errored" } : undefined
  );
  Errors || (Errors = new Set());
  Errors.add(setErrored);
  onCleanup(() => Errors.delete(setErrored));
  return createMemo(
    () => {
      let e: any;
      if ((e = errored())) {
        const f = props.fallback;
        if ("_SOLID_DEV_" && (typeof f !== "function" || f.length == 0)) console.error(e);
        const res =
          typeof f === "function" && f.length ? untrack(() => f(e, () => setErrored())) : f;
        onError(setErrored);
        return res;
      }
      onError(setErrored);
      return props.children;
    },
    undefined,
    "_SOLID_DEV_" ? { name: "value" } : undefined
  ) as Accessor<JSX.Element>;
}
