import { children, IS_DEV } from "../client/core.js";
import {
  createMemo,
  untrack,
  mapArray,
  repeat,
  createRevealOrder,
  getOwner,
  runWithOwner
} from "@solidjs/signals";
import { createErrorBoundary, createLoadingBoundary } from "./hydration.js";
import type { Accessor, RevealOrder } from "@solidjs/signals";
export type { RevealOrder };
import type { Element as SolidElement } from "../types.js";

type NonZeroParams<T extends (...args: any[]) => any> = Parameters<T>["length"] extends 0
  ? never
  : T;
type ErrorAccessor = Accessor<unknown>;
type ConditionalRenderCallback<T> = (item: Accessor<NonNullable<T>>) => SolidElement;
type KeyedConditionalRenderCallback<T> = (item: NonNullable<T>) => SolidElement;
type ConditionalRenderChildren<
  T,
  F extends ConditionalRenderCallback<T> = ConditionalRenderCallback<T>
> = SolidElement | NonZeroParams<F>;
type KeyedConditionalRenderChildren<
  T,
  F extends KeyedConditionalRenderCallback<T> = KeyedConditionalRenderCallback<T>
> = SolidElement | NonZeroParams<F>;
type ForOptions<T> = {
  keyed?: boolean | ((item: T) => any);
  fallback?: Accessor<SolidElement>;
  name?: string;
};

const narrowedError = (name: string) =>
  IS_DEV
    ? `Attempting to access a stale value from <${name}> that could possibly be undefined. This may occur because you are reading the accessor returned from the component at a time where it has already been unmounted. We recommend cleaning up any stale timers or async, or reading from the initial condition.`
    : `Stale read from <${name}>.`;

/**
 * Creates a list of elements from a list.
 *
 * Receives a map function as its child and returns a JSX element for each
 * list item; if the list is empty, an optional `fallback` is rendered instead.
 *
 * The child callback shape follows the keying mode:
 * - default / `keyed={true}` receives `(item, index)` where `item` is the raw
 *   row value and `index` is an accessor.
 * - `keyed={false}` receives `(item, index)` where `item` is an accessor and
 *   `index` is a stable number.
 * - `keyed={(item) => key}` receives accessors for both arguments.
 *
 * @example
 * ```tsx
 * <For each={items} fallback={<div>No items</div>}>
 *   {(item, index) => <div data-index={index()}>{item.label}</div>}
 * </For>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/for
 */
export function For<T extends readonly any[], U extends SolidElement>(props: {
  each: T | undefined | null | false;
  fallback?: SolidElement;
  keyed?: true;
  children: (item: T[number], index: Accessor<number>) => U;
}): SolidElement;
export function For<T extends readonly any[], U extends SolidElement>(props: {
  each: T | undefined | null | false;
  fallback?: SolidElement;
  keyed: false;
  children: (item: Accessor<T[number]>, index: number) => U;
}): SolidElement;
export function For<T extends readonly any[], U extends SolidElement>(props: {
  each: T | undefined | null | false;
  fallback?: SolidElement;
  keyed: (item: T[number]) => any;
  children: (item: Accessor<T[number]>, index: Accessor<number>) => U;
}): SolidElement;
export function For<T extends readonly any[], U extends SolidElement>(props: {
  each: T | undefined | null | false;
  fallback?: SolidElement;
  keyed?: boolean | ((item: T[number]) => any);
  children: (item: any, index: any) => U;
}): SolidElement {
  const options: ForOptions<T[number]> =
    "fallback" in props
      ? { keyed: props.keyed, fallback: () => props.fallback }
      : { keyed: props.keyed };
  if (IS_DEV) options.name = "<For>";
  // Patch-mode list seam (DESIGN-PATCH-CHANNEL §3b): the returned accessor
  // carries `$ll` metadata so a row-ops-aware renderer can drive a keyed
  // store array structurally (registerRowOps → moves/creates/removals),
  // bypassing mapArray entirely. Renderers that don't recognize the marker —
  // and any list the driver declines (non-store each, impure rows, fallback/
  // index usage) — simply call the accessor and get the classic mapArray
  // path, created lazily under the component's owner on first read.
  const owner = getOwner();
  let mapped: (() => any) | undefined;
  const list = () => {
    if (mapped === undefined)
      mapped = runWithOwner(owner, () =>
        mapArray(() => props.each, props.children as any, options as any)
      ) as () => any;
    return mapped();
  };
  if (props.keyed !== false && !("fallback" in props) && props.children.length < 2)
    (list as any).$ll = { each: () => props.each, row: props.children };
  return list as unknown as SolidElement;
}

/**
 * Creates a list of elements from a count.
 *
 * Receives a map function as its child that takes the index and returns a JSX
 * element; if the count is zero, an optional `fallback` is rendered instead.
 *
 * @example
 * ```tsx
 * <Repeat count={items.length} fallback={<div>No items</div>}>
 *   {(index) => <div data-index={index}>{items[index]}</div>}
 * </Repeat>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/repeat
 */
export function Repeat<T extends SolidElement>(props: {
  count: number;
  from?: number | undefined;
  fallback?: SolidElement;
  children: ((index: number) => T) | T;
}) {
  const options: {
    fallback?: Accessor<SolidElement>;
    from?: Accessor<number | undefined>;
    name?: string;
  } = "fallback" in props ? { fallback: () => props.fallback } : {};
  options.from = () => props.from;
  if (IS_DEV) options.name = "<Repeat>";
  return repeat(
    () => props.count,
    index => (typeof props.children === "function" ? props.children(index) : props.children),
    options
  ) as unknown as SolidElement;
}

/**
 * Conditionally renders its children when `when` is truthy, otherwise renders
 * the optional `fallback`.
 *
 * The function-child form receives a narrowed value. Without `keyed`
 * (default), it receives an accessor and the child is preserved across truthy
 * values; with `keyed`, it receives the raw value and remounts whenever the
 * value's identity changes.
 *
 * @example
 * ```tsx
 * <Show when={user()} fallback={<SignIn />}>
 *   {u => <Greeting name={u().name} />}
 * </Show>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/show
 */
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed: true;
  fallback?: SolidElement;
  children: SolidElement;
}): SolidElement;
export function Show<T, F extends KeyedConditionalRenderCallback<T>>(props: {
  when: T | undefined | null | false;
  keyed: true;
  fallback?: SolidElement;
  children: NonZeroParams<F>;
}): SolidElement;
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  fallback?: SolidElement;
  children: SolidElement;
}): SolidElement;
export function Show<T, F extends ConditionalRenderCallback<T>>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  fallback?: SolidElement;
  children: NonZeroParams<F>;
}): SolidElement;
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  fallback?: SolidElement;
  children: SolidElement | ((item: any) => SolidElement);
}): SolidElement {
  const keyed = props.keyed;
  // `props.when` is user input — may be a pending async read. Keep this memo
  // async-shape aware (no `sync: true`) so a Promise/AsyncIterable returned by
  // the user's reactive expression flows through `handleAsync`.
  const conditionValue = createMemo<T | undefined | null | boolean>(
    () => props.when,
    IS_DEV ? { name: "condition value" } : undefined
  );
  // `condition` and the outer value memo only consume `conditionValue()` and
  // pick a child / fallback. Their bodies are statically synchronous (they
  // never return a Promise / AsyncIterable), so `sync: true` skips the
  // per-recompute async-shape probe in `recompute`.
  const condition = keyed
    ? conditionValue
    : createMemo(
        conditionValue,
        IS_DEV
          ? {
              equals: (a, b) => !a === !b,
              name: "condition",
              sync: true
            }
          : { equals: (a, b) => !a === !b, sync: true }
      );
  return createMemo(
    () => {
      const c = condition();
      if (c) {
        const child = props.children;
        const fn = typeof child === "function" && child.length > 0;
        return fn
          ? keyed
            ? untrack(() => (child as any)(c), IS_DEV && "<Show>")
            : untrack(
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
    IS_DEV ? { name: "value", sync: true } : { sync: true }
  ) as unknown as SolidElement;
}

type EvalConditions = readonly [number, unknown, Accessor<unknown>, AnyMatchProps<unknown>];

/**
 * Switches between content based on mutually exclusive conditions. Renders
 * the first `<Match>` whose `when` is truthy; falls back to `fallback` when
 * none match.
 *
 * @example
 * ```tsx
 * <Switch fallback={<FourOhFour />}>
 *   <Match when={state.route === 'home'}>
 *     <Home />
 *   </Match>
 *   <Match when={state.route === 'settings'}>
 *     <Settings />
 *   </Match>
 * </Switch>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/switch-and-match
 */
export function Switch(props: { fallback?: SolidElement; children: SolidElement }): SolidElement {
  const chs = children(() => props.children);
  // `switchFunc` body just walks `chs.toArray()` and builds a selector
  // function. Synchronous by construction.
  const switchFunc = createMemo<Accessor<EvalConditions | undefined>>(
    () => {
      const mps = chs.toArray() as unknown as AnyMatchProps<unknown>[];
      let func: Accessor<EvalConditions | undefined> = () => undefined;
      for (let i = 0; i < mps.length; i++) {
        const index = i;
        const mp = mps[i];
        // A conditionally excluded Match (false <Show> around it) resolves to
        // a nullish slot — skip it like boolean children already are (#2911).
        if (mp == null) continue;
        const prevFunc = func;
        // Per-match `mp.when` is user input — keep async-shape aware.
        const conditionValue = createMemo(
          () => (prevFunc() ? undefined : mp.when),
          IS_DEV ? { name: "condition value" } : undefined
        );
        // Stale-protection wrapper. Body is sync; just normalises identity.
        const condition = mp.keyed
          ? conditionValue
          : createMemo(
              conditionValue,
              IS_DEV
                ? {
                    equals: (a, b) => !a === !b,
                    name: "condition",
                    sync: true
                  }
                : { equals: (a, b) => !a === !b, sync: true }
            );
        func = () => {
          const prev = prevFunc();
          if (prev) return prev;
          const c = condition();
          return c ? [index, c, conditionValue, mp] : undefined;
        };
      }
      return func;
    },
    { sync: true }
  );
  return createMemo(
    () => {
      const sel = switchFunc()();
      if (!sel) return props.fallback;
      const [index, value, conditionValue, mp] = sel;
      const child = mp.children;
      const fn = typeof child === "function" && child.length > 0;
      return fn
        ? mp.keyed
          ? untrack(() => (child as any)(value), IS_DEV && "<Match>")
          : untrack(
              () =>
                (child as any)(() => {
                  if (untrack(switchFunc)()?.[0] !== index) throw narrowedError("Match");
                  return conditionValue();
                }),
              IS_DEV && "<Match>"
            )
        : child;
    },
    IS_DEV ? { name: "eval conditions", sync: true } : { sync: true }
  ) as unknown as SolidElement;
}

export type MatchProps<T, F extends ConditionalRenderCallback<T> = ConditionalRenderCallback<T>> = {
  when: T | undefined | null | false;
  keyed?: false;
  children: ConditionalRenderChildren<T, F>;
};
export type KeyedMatchProps<
  T,
  F extends KeyedConditionalRenderCallback<T> = KeyedConditionalRenderCallback<T>
> = {
  when: T | undefined | null | false;
  keyed: true;
  children: KeyedConditionalRenderChildren<T, F>;
};
export type AnyMatchProps<T> =
  | MatchProps<T>
  | KeyedMatchProps<T>
  | {
      when: T | undefined | null | false;
      keyed?: boolean;
      children: SolidElement;
    };
/**
 * A branch inside a `<Switch>`. The first `<Match>` whose `when` is truthy
 * wins; remaining matches are skipped.
 *
 * Like `<Show>`, `<Match>` supports a function child. Non-keyed children
 * receive an accessor for the narrowed value; keyed children receive the raw
 * narrowed value.
 *
 * @example
 * ```tsx
 * <Switch fallback={<NotFound />}>
 *   <Match when={user()}>
 *     {u => <Profile name={u().name} />}
 *   </Match>
 *   <Match when={loading()}>
 *     <Spinner />
 *   </Match>
 * </Switch>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/switch-and-match
 */
export function Match<T>(props: {
  when: T | undefined | null | false;
  keyed: true;
  children: SolidElement;
}): SolidElement;
export function Match<T, F extends KeyedConditionalRenderCallback<T>>(
  props: KeyedMatchProps<T, F>
): SolidElement;
export function Match<T>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  children: SolidElement;
}): SolidElement;
export function Match<T, F extends ConditionalRenderCallback<T>>(
  props: MatchProps<T, F>
): SolidElement;
export function Match<T>(props: AnyMatchProps<T>): SolidElement;
export function Match<T>(props: AnyMatchProps<T>) {
  return props as unknown as SolidElement;
}

/**
 * Catches uncaught errors inside its subtree and renders fallback content
 * instead. The `fallback` prop can be a JSX element, or a callback that
 * receives the error and a `reset()` function for retry affordances.
 *
 * Errors thrown from the fallback itself can be caught by a parent
 * `<Errored>`.
 *
 * @example
 * ```tsx
 * <Errored fallback={(err, reset) => (
 *   <div onClick={reset}>Error: {err().toString()}</div>
 * )}>
 *   <MyComp />
 * </Errored>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/error-boundary
 */
export function Errored(props: {
  fallback: SolidElement | ((err: ErrorAccessor, reset: () => void) => SolidElement);
  children: SolidElement;
}): SolidElement {
  return createErrorBoundary(
    () => props.children,
    (err: ErrorAccessor, reset) => {
      const f = props.fallback;
      if (IS_DEV && (typeof f !== "function" || f.length == 0)) console.error(err());
      return typeof f === "function" && f.length ? f(err, reset) : f;
    }
  ) as unknown as SolidElement;
}

/**
 * Renders a `fallback` while pending async reads inside the subtree settle.
 *
 * Any computation (`createMemo`, `createSignal(fn)`, `createStore(fn)`,
 * `lazy(...)`, etc.) that throws because data isn't ready is caught by the
 * nearest enclosing `<Loading>`. The boundary swaps to its `fallback` until
 * every pending read has resolved, then renders the children.
 *
 * The optional `on` prop scopes the boundary so it ignores transitions
 * caused by writes to other reactive sources — those transitions stay on the
 * previous content (with `isPending()` flipping during the transition).
 *
 * Scope `<Loading>` around the data-dependent slot, not the surrounding
 * shell. Wrapping layout chrome (header, nav, footer) in the same boundary
 * as the data means revalidation replaces the entire screen with the
 * fallback; rendering chrome outside the boundary keeps it stable while
 * only the affordance flips.
 *
 * @example
 * ```tsx
 * const Profile = lazy(() => import("./Profile"));
 *
 * <Loading fallback={<Spinner />}>
 *   <Profile />
 * </Loading>
 * ```
 *
 * @example
 * ```tsx
 * // Only show the fallback for transitions caused by writes to `route`.
 * <Loading fallback={<Skeleton />} on={route}>
 *   <Page />
 * </Loading>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/suspense
 */
export function Loading(props: {
  fallback?: SolidElement;
  on?: any;
  children: SolidElement;
}): SolidElement {
  const onOpt = "on" in props ? { on: () => props.on } : undefined;
  return createLoadingBoundary(
    () => props.children,
    () => props.fallback,
    onOpt
  ) as unknown as SolidElement;
}

export type RevealProps = {
  order?: RevealOrder;
  collapsed?: boolean;
  children: SolidElement;
};

/**
 * Coordinates the reveal timing of sibling `<Loading>` boundaries.
 *
 * The `order` prop picks the reveal policy:
 * - `"sequential"` (default) — boundaries reveal in registration order; later boundaries
 *   stay on their fallback until earlier ones resolve.
 * - `"together"` — every direct slot stays on its fallback until the whole group is
 *   "minimally ready" (every direct slot has its own first visible content available),
 *   then the group releases in one cohesive reveal.
 * - `"natural"` — each boundary reveals as its own data resolves. At the top level
 *   this is equivalent to omitting `<Reveal>`; the mode exists for nesting, where
 *   the group registers as a single composite slot in an enclosing `<Reveal>`.
 *
 * The `collapsed` prop is only consulted when `order="sequential"` (the default);
 * it is ignored under `"together"` and `"natural"`. When set, tail boundaries past
 * the frontier suppress their own fallback output.
 *
 * Nested `<Reveal>` groups compose: the inner group is one slot in the outer order
 * and is held on its fallbacks until the outer releases the slot. Once released, the
 * inner group runs its own `order` locally over whatever is still pending. There is
 * no escape hatch — nesting under an outer group means participating in its ordering.
 * See `documentation/solid-2.0/03-control-flow.md` for the full nesting matrix and the
 * "minimally ready" definition per order.
 *
 * @example
 * ```tsx
 * // Default order is "sequential"; the inner group composes as one slot
 * // and runs its own "natural" order locally once the outer releases it.
 * <Reveal>
 *   <Loading fallback={<Skeleton />}><ProfileHeader /></Loading>
 *   <Reveal order="natural">
 *     <Loading fallback={<Skeleton />}><PostA /></Loading>
 *     <Loading fallback={<Skeleton />}><PostB /></Loading>
 *   </Reveal>
 *   <Loading fallback={<Skeleton />}><Comments /></Loading>
 * </Reveal>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/reveal
 */
export function Reveal(props: RevealProps): SolidElement {
  return createRevealOrder(() => props.children, {
    order: () => props.order ?? "sequential",
    collapsed: () => !!props.collapsed
  }) as unknown as SolidElement;
}
