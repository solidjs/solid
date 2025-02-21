import {
  createMemo,
  untrack,
  createSignal,
  catchError,
  children,
  Accessor,
  Setter,
  onCleanup,
  IS_DEV
} from "../reactive/signal.js";
import { mapArray, indexArray } from "../reactive/array.js";
import { sharedConfig } from "./hydration.js";
import type { JSX } from "../jsx.js";

const narrowedError = (name: string) =>
  IS_DEV
    ? `Attempting to access a stale value from <${name}> that could possibly be undefined. This may occur because you are reading the accessor returned from the component at a time where it has already been unmounted. We recommend cleaning up any stale timers or async, or reading from the initial condition.`
    : `Stale read from <${name}>.`;

/**
 * Creates a list elements from a list
 *
 * it receives a map function as its child that receives a list element and an accessor with the index and returns a JSX-Element; if the list is empty, an optional fallback is returned:
 * ```typescript
 * <For each={items} fallback={<div>No items</div>}>
 *   {(item, index) => <div data-index={index()}>{item}</div>}
 * </For>
 * ```
 * If you have a list with fixed indices and changing values, consider using `<Index>` instead.
 *
 * @description https://docs.solidjs.com/reference/components/for
 */
export function For<T extends readonly any[], U extends JSX.Element>(props: {
  each: T | undefined | null | false;
  fallback?: JSX.Element;
  children: (item: T[number], index: Accessor<number>) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return (IS_DEV
    ? createMemo(
        mapArray(() => props.each, props.children, fallback || undefined),
        undefined,
        { name: "value" }
      )
    : createMemo(
        mapArray(() => props.each, props.children, fallback || undefined)
      )) as unknown as JSX.Element;
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
 * @description https://docs.solidjs.com/reference/components/index
 */
export function Index<T extends readonly any[], U extends JSX.Element>(props: {
  each: T | undefined | null | false;
  fallback?: JSX.Element;
  children: (item: Accessor<T[number]>, index: number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return (IS_DEV
    ? createMemo(
        indexArray(() => props.each, props.children, fallback || undefined),
        undefined,
        { name: "value" }
      )
    : createMemo(
        indexArray(() => props.each, props.children, fallback || undefined)
      )) as unknown as JSX.Element;
}

type RequiredParameter<T> = T extends () => unknown ? never : T;
/**
 * Conditionally render its children or an optional fallback component
 * @description https://docs.solidjs.com/reference/components/show
 */
export function Show<
  T,
  TRenderFunction extends (item: Accessor<NonNullable<T>>) => JSX.Element
>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  fallback?: JSX.Element;
  children: JSX.Element | RequiredParameter<TRenderFunction>;
}): JSX.Element;
export function Show<T, TRenderFunction extends (item: NonNullable<T>) => JSX.Element>(props: {
  when: T | undefined | null | false;
  keyed: true;
  fallback?: JSX.Element;
  children: JSX.Element | RequiredParameter<TRenderFunction>;
}): JSX.Element;
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => JSX.Element);
}): JSX.Element {
  const keyed = props.keyed;
  const conditionValue = createMemo<T | undefined | null | boolean>(
    () => props.when,
    undefined,
    IS_DEV ? { name: "condition value" } : undefined
  );
  const condition = keyed
    ? conditionValue
    : createMemo(
        conditionValue,
        undefined,
        IS_DEV
          ? {
              equals: (a, b) => !a === !b,
              name: "condition"
            }
          : { equals: (a, b) => !a === !b }
      );
  return createMemo(
    () => {
      const c = condition();
      if (c) {
        const child = props.children;
        const fn = typeof child === "function" && child.length > 0;
        return fn
          ? untrack(() =>
              (child as any)(
                keyed
                  ? (c as T)
                  : () => {
                      if (!untrack(condition)) throw narrowedError("Show");
                      return conditionValue();
                    }
              )
            )
          : child;
      }
      return props.fallback;
    },
    undefined,
    IS_DEV ? { name: "value" } : undefined
  ) as unknown as JSX.Element;
}

type EvalConditions = readonly [number, Accessor<unknown>, MatchProps<unknown>];

/**
 * Switches between content based on mutually exclusive conditions
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
 * @description https://docs.solidjs.com/reference/components/switch-and-match
 */
export function Switch(props: { fallback?: JSX.Element; children: JSX.Element }): JSX.Element {
  const chs = children(() => props.children);
  const switchFunc = createMemo(() => {
    const ch = chs() as unknown as MatchProps<unknown> | MatchProps<unknown>[];
    const mps = Array.isArray(ch) ? ch : [ch];
    let func: Accessor<EvalConditions | undefined> = () => undefined;
    for (let i = 0; i < mps.length; i++) {
      const index = i;
      const mp = mps[i];
      const prevFunc = func;
      const conditionValue = createMemo(
        () => (prevFunc() ? undefined : mp.when),
        undefined,
        IS_DEV ? { name: "condition value" } : undefined
      );
      const condition = mp.keyed
        ? conditionValue
        : createMemo(
            conditionValue,
            undefined,
            IS_DEV
              ? {
                  equals: (a, b) => !a === !b,
                  name: "condition"
                }
              : { equals: (a, b) => !a === !b }
          );
      func = () => prevFunc() || (condition() ? [index, conditionValue, mp] : undefined);
    }
    return func;
  });
  return createMemo(
    () => {
      const sel = switchFunc()();
      if (!sel) return props.fallback;
      const [index, conditionValue, mp] = sel;
      const child = mp.children;
      const fn = typeof child === "function" && child.length > 0;
      return fn
        ? untrack(() =>
            (child as any)(
              mp.keyed
                ? (conditionValue() as any)
                : () => {
                    if (untrack(switchFunc)()?.[0] !== index) throw narrowedError("Match");
                    return conditionValue();
                  }
            )
          )
        : child;
    },
    undefined,
    IS_DEV ? { name: "eval conditions" } : undefined
  ) as unknown as JSX.Element;
}

export type MatchProps<T> = {
  when: T | undefined | null | false;
  keyed?: boolean;
  children: JSX.Element | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => JSX.Element);
};
/**
 * Selects a content based on condition when inside a `<Switch>` control flow
 * ```typescript
 * <Match when={condition()}>
 *   <Content/>
 * </Match>
 * ```
 * @description https://docs.solidjs.com/reference/components/switch-and-match
 */
export function Match<
  T,
  TRenderFunction extends (item: Accessor<NonNullable<T>>) => JSX.Element
>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  children: JSX.Element | RequiredParameter<TRenderFunction>;
}): JSX.Element;
export function Match<T, TRenderFunction extends (item: NonNullable<T>) => JSX.Element>(props: {
  when: T | undefined | null | false;
  keyed: true;
  children: JSX.Element | RequiredParameter<TRenderFunction>;
}): JSX.Element;
export function Match<T>(props: MatchProps<T>) {
  return props as unknown as JSX.Element;
}

let Errors: Set<Setter<any>>;
export function resetErrorBoundaries() {
  Errors && [...Errors].forEach(fn => fn());
}
/**
 * Catches uncaught errors inside components and renders a fallback content
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
 * @description https://docs.solidjs.com/reference/components/error-boundary
 */
export function ErrorBoundary(props: {
  fallback: JSX.Element | ((err: any, reset: () => void) => JSX.Element);
  children: JSX.Element;
}): JSX.Element {
  let err;
  if (sharedConfig!.context && sharedConfig!.load)
    err = sharedConfig.load(sharedConfig.getContextId());
  const [errored, setErrored] = createSignal<any>(err, IS_DEV ? { name: "errored" } : undefined);
  Errors || (Errors = new Set());
  Errors.add(setErrored);
  onCleanup(() => Errors.delete(setErrored));
  return createMemo(
    () => {
      let e: any;
      if ((e = errored())) {
        const f = props.fallback;
        if (IS_DEV && (typeof f !== "function" || f.length == 0)) console.error(e);
        return typeof f === "function" && f.length ? untrack(() => f(e, () => setErrored())) : f;
      }
      return catchError(() => props.children, setErrored);
    },
    undefined,
    IS_DEV ? { name: "value" } : undefined
  ) as unknown as JSX.Element;
}
