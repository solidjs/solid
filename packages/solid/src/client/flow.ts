import { children, IS_DEV } from "../client/core.js";
import {
  createMemo,
  untrack,
  createSignal,
  catchError,
  mapArray,
  onCleanup,
  SignalOptions,
  createSuspense
} from "@solidjs/signals";
import type { Accessor, Setter } from "@solidjs/signals";
import { sharedConfig } from "./hydration.js";
import type { JSX } from "../jsx.js";
import { create } from "domain";

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
  keyed?: boolean | ((item: T) => any);
  children: (item: T[number], index: Accessor<number>) => U;
}) {
  const options =
    "fallback" in props ? { keyed: props.keyed, fallback: () => props.fallback } : props;
  return (IS_DEV
    ? createMemo(
        mapArray(() => props.each, props.children, options),
        undefined,
        { name: "value" }
      )
    : createMemo(mapArray(() => props.each, props.children, options))) as unknown as JSX.Element;
}

/**
 * Conditionally render its children or an optional fallback component
 * @description https://docs.solidjs.com/reference/components/show
 */
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: Accessor<NonNullable<T>>) => JSX.Element);
}): JSX.Element {
  const keyed = props.keyed;
  const condition = createMemo<T | undefined | null | boolean>(
    () => props.when,
    undefined,
    IS_DEV
      ? {
          equals: (a, b) => (keyed ? a === b : !a === !b),
          name: "condition"
        }
      : { equals: (a, b) => (keyed ? a === b : !a === !b) }
  );
  return createMemo(
    () => {
      const c = condition();
      if (c) {
        const child = props.children;
        const fn = typeof child === "function" && child.length > 0;
        return fn
          ? untrack(() =>
              (child as any)(() => {
                if (!untrack(condition)) throw narrowedError("Show");
                return props.when;
              })
            )
          : child;
      }
      return props.fallback;
    },
    undefined,
    IS_DEV ? { name: "value" } : undefined
  ) as unknown as JSX.Element;
}

type EvalConditions = readonly [number, unknown?, MatchProps<unknown>?];

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
  let keyed = false;
  const equals: SignalOptions<EvalConditions>["equals"] = (a, b) =>
    (keyed ? a[1] === b[1] : !a[1] === !b[1]) && a[2] === b[2];
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
      IS_DEV ? { equals, name: "eval conditions" } : { equals }
    );
  return createMemo(
    () => {
      const [index, when, cond] = evalConditions();
      if (index < 0) return props.fallback;
      const c = cond!.children;
      const fn = typeof c === "function" && c.length > 0;
      return fn
        ? untrack(() =>
            (c as any)(() => {
              if (untrack(evalConditions)[0] !== index) throw narrowedError("Match");
              return cond!.when;
            })
          )
        : c;
    },
    undefined,
    IS_DEV ? { name: "value" } : undefined
  ) as unknown as JSX.Element;
}

export type MatchProps<T> = {
  when: T | undefined | null | false;
  keyed?: boolean;
  children: JSX.Element | ((item: Accessor<NonNullable<T>>) => JSX.Element);
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

/**
 * Tracks all resources inside a component and renders a fallback until they are all resolved
 * ```typescript
 * const AsyncComponent = lazy(() => import('./component'));
 *
 * <Suspense fallback={<LoadingIndicator />}>
 *   <AsyncComponent />
 * </Suspense>
 * ```
 * @description https://docs.solidjs.com/reference/components/suspense
 */
export function Suspense(props: { fallback?: JSX.Element; children: JSX.Element }): JSX.Element {
  return createMemo(
    createSuspense(
      children(() => props.children),
      () => props.fallback
    ),
    undefined,
    IS_DEV ? { name: "value" } : undefined
  ) as unknown as JSX.Element;
}
