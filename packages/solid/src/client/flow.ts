import { children, IS_DEV } from "../client/core.js";
import { createMemo, untrack, mapArray, repeat, createRevealOrder } from "@solidjs/signals";
import { createErrorBoundary, createLoadingBoundary } from "./hydration.js";
import type { Accessor } from "@solidjs/signals";
import type { JSX } from "../jsx.js";

type NonZeroParams<T extends (...args: any[]) => any> = Parameters<T>["length"] extends 0
  ? never
  : T;
type ConditionalRenderCallback<T> = (item: Accessor<NonNullable<T>>) => JSX.Element;
type ConditionalRenderChildren<
  T,
  F extends ConditionalRenderCallback<T> = ConditionalRenderCallback<T>
> = JSX.Element | NonZeroParams<F>;

const narrowedError = (name: string) =>
  IS_DEV
    ? `Attempting to access a stale value from <${name}> that could possibly be undefined. This may occur because you are reading the accessor returned from the component at a time where it has already been unmounted. We recommend cleaning up any stale timers or async, or reading from the initial condition.`
    : `Stale read from <${name}>.`;

/**
 * Creates a list of elements from a list
 *
 * it receives a map function as its child that receives list element and index accessors and returns a JSX-Element; if the list is empty, an optional fallback is returned:
 * ```typescript
 * <For each={items} fallback={<div>No items</div>}>
 *   {(item, index) => <div data-index={index()}>{item()}</div>}
 * </For>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/for
 */
export function For<T extends readonly any[], U extends JSX.Element>(props: {
  each: T | undefined | null | false;
  fallback?: JSX.Element;
  keyed?: boolean | ((item: T[number]) => any);
  children: (item: Accessor<T[number]>, index: Accessor<number>) => U;
}) {
  const options: Parameters<typeof mapArray>[2] =
    "fallback" in props
      ? { keyed: props.keyed, fallback: () => props.fallback }
      : { keyed: props.keyed };
  if (IS_DEV) options!.name = "<For>";
  return mapArray(() => props.each, props.children, options) as unknown as JSX.Element;
}

/**
 * Creates a list elements from a count
 *
 * it receives a map function as its child that receives the index and returns a JSX-Element; if the list is empty, an optional fallback is returned:
 * ```typescript
 * <Repeat count={items.length} fallback={<div>No items</div>}>
 *   {(index) => <div data-index={index}>{items[index]}</div>}
 * </Repeat>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/repeat
 */
export function Repeat<T extends JSX.Element>(props: {
  count: number;
  from?: number | undefined;
  fallback?: JSX.Element;
  children: ((index: number) => T) | T;
}) {
  const options: {
    fallback?: Accessor<JSX.Element>;
    from?: Accessor<number | undefined>;
    name?: string;
  } = "fallback" in props ? { fallback: () => props.fallback } : {};
  options.from = () => props.from;
  if (IS_DEV) options.name = "<Repeat>";
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
          ? untrack(
              () =>
                (child as any)(() => {
                  if (!untrack(condition)) throw narrowedError("Show");
                  return conditionValue();
                }),
              IS_DEV && "<Show>"
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
    const mps = chs.toArray() as unknown as MatchProps<unknown>[];
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
        ? untrack(
            () =>
              (child as any)(() => {
                if (untrack(switchFunc)()?.[0] !== index) throw narrowedError("Match");
                return conditionValue();
              }),
            IS_DEV && "<Match>"
          )
        : child;
    },
    undefined,
    IS_DEV ? { name: "eval conditions" } : undefined
  ) as unknown as JSX.Element;
}

export type MatchProps<T, F extends ConditionalRenderCallback<T> = ConditionalRenderCallback<T>> = {
  when: T | undefined | null | false;
  keyed?: boolean;
  children: ConditionalRenderChildren<T, F>;
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
export function Match<T, F extends ConditionalRenderCallback<T>>(props: MatchProps<T, F>) {
  return props as unknown as JSX.Element;
}

/**
 * Catches uncaught errors inside components and renders a fallback content
 *
 * Also supports a callback form that passes the error and a reset function:
 * ```typescript
 * <Errored fallback={
 *   (err, reset) => <div onClick={reset}>Error: {err.toString()}</div>
 * }>
 *   <MyComp />
 * </Errored>
 * ```
 * Errors thrown from the fallback can be caught by a parent Errored
 *
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
      if (IS_DEV && (typeof f !== "function" || f.length == 0)) console.error(err);
      return typeof f === "function" && f.length ? f(err, reset) : f;
    }
  ) as unknown as JSX.Element;
}

/**
 * Tracks all resources inside a component and renders a fallback until they are all resolved
 * ```typescript
 * const AsyncComponent = lazy(() => import('./component'));
 *
 * <Loading fallback={<LoadingIndicator />}>
 *   <AsyncComponent />
 * </Loading>
 * ```
 * @description https://docs.solidjs.com/reference/components/suspense
 */
export function Loading(props: {
  fallback?: JSX.Element;
  on?: any;
  children: JSX.Element;
}): JSX.Element {
  const onOpt = "on" in props ? { on: () => props.on } : undefined;
  return createLoadingBoundary(
    () => props.children,
    () => props.fallback,
    onOpt
  ) as unknown as JSX.Element;
}

/**
 * Coordinates the reveal timing of sibling `<Loading>` boundaries.
 *
 * - **Sequential** (default): boundaries reveal in DOM order as each resolves.
 * - **Together** (`together`): all boundaries wait until the group is ready, then reveal at once.
 * - **Collapsed** (`collapsed`, sequential only): only the frontier boundary shows its fallback;
 *   later boundaries produce nothing until their turn.
 *
 * ```typescript
 * <Reveal>
 *   <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
 *   <Loading fallback={<Skeleton />}><Posts /></Loading>
 * </Reveal>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/reveal
 */
export function Reveal(props: {
  together?: boolean;
  collapsed?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return createRevealOrder(() => props.children, {
    together: () => !!props.together,
    collapsed: () => !!props.collapsed
  }) as unknown as JSX.Element;
}
