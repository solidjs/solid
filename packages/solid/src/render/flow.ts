import { createMemo, untrack, createSignal, onError, children, Accessor } from "../reactive/signal";
import { mapArray, indexArray } from "../reactive/array";
import type { JSX } from "../jsx";

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
export function For<T, U extends JSX.Element>(props: {
  each: readonly T[] | undefined | null | false;
  fallback?: JSX.Element;
  children: (item: T, index: Accessor<number>) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return createMemo(
    mapArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined)
  );
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
export function Index<T, U extends JSX.Element>(props: {
  each: readonly T[] | undefined | null | false;
  fallback?: JSX.Element;
  children: (item: Accessor<T>, index: number) => U;
}) {
  const fallback = "fallback" in props && { fallback: () => props.fallback };
  return createMemo(
    indexArray<T, U>(() => props.each, props.children, fallback ? fallback : undefined)
  );
}

/**
 * Conditionally render its children or an optional fallback component
 * @description https://www.solidjs.com/docs/latest/api#%3Cshow%3E
 */
export function Show<T>(props: {
  when: T | undefined | null | false;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: NonNullable<T>) => JSX.Element);
}) {
  let strictEqual = false;
  const condition = createMemo<T | undefined | null | boolean>(() => props.when, undefined, {
    equals: (a, b) => (strictEqual ? a === b : !a === !b)
  });
  return createMemo(() => {
    const c = condition();
    if (c) {
      const child = props.children;
      return (strictEqual = typeof child === "function" && child.length > 0)
        ? untrack(() => (child as any)(c as T))
        : child;
    }
    return props.fallback;
  }) as () => JSX.Element;
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
  const conditions = children(() => props.children) as unknown as () => MatchProps<unknown>[],
    evalConditions = createMemo(
      (): EvalConditions => {
        let conds = conditions();
        if (!Array.isArray(conds)) conds = [conds];
        for (let i = 0; i < conds.length; i++) {
          const c = conds[i].when;
          if (c) return [i, c, conds[i]];
        }
        return [-1];
      },
      undefined,
      {
        equals: (a, b) =>
          a[0] === b[0] && (strictEqual ? a[1] === b[1] : !a[1] === !b[1]) && a[2] === b[2]
      }
    );
  return createMemo(() => {
    const [index, when, cond] = evalConditions();
    if (index < 0) return props.fallback;
    const c = cond!.children;
    return (strictEqual = typeof c === "function" && c.length > 0)
      ? untrack(() => (c as any)(when))
      : c;
  });
}

export type MatchProps<T> = {
  when: T | undefined | null | false;
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
export function Match<T>(props: MatchProps<T>) {
  return props as unknown as JSX.Element;
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
  const [errored, setErrored] = createSignal<any>();
  let e: any;
  return createMemo(() => {
    if ((e = errored()) != null) {
      const f = props.fallback;
      return typeof f === "function" && f.length ? untrack(() => f(e, () => setErrored(null))) : f;
    }
    onError(setErrored);
    return props.children;
  }) as Accessor<JSX.Element>;
}
