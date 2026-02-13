import type { Computed } from "./core/index.js";
import {
  computed,
  createRoot,
  dispose,
  effect,
  EFFECT_USER,
  getOwner,
  NotReadyError,
  onCleanup,
  optimisticComputed,
  optimisticSignal,
  read,
  runWithOwner,
  setSignal,
  signal,
  trackedEffect,
  untrack
} from "./core/index.js";
import { globalQueue } from "./core/scheduler.js";

export type Accessor<T> = () => T;

export type Setter<in out T> = {
  <U extends T>(
    ...args: undefined extends T ? [] : [value: Exclude<U, Function> | ((prev: T) => U)]
  ): undefined extends T ? undefined : U;
  <U extends T>(value: (prev: T) => U): U;
  <U extends T>(value: Exclude<U, Function>): U;
  <U extends T>(value: Exclude<U, Function> | ((prev: T) => U)): U;
};

export type Signal<T> = [get: Accessor<T>, set: Setter<T>];

export type ComputeFunction<Prev, Next extends Prev = Prev> = (
  v: Prev
) => PromiseLike<Next> | AsyncIterable<Next> | Next;
export type EffectFunction<Prev, Next extends Prev = Prev> = (
  v: Next,
  p?: Prev
) => (() => void) | void;
export type EffectBundle<Prev, Next extends Prev = Prev> = {
  effect: EffectFunction<Prev, Next>;
  error: (err: unknown, cleanup: () => void) => void;
};

/** Options for effect primitives (`createEffect`, `createRenderEffect`, `createTrackedEffect`, `createReaction`). */
export interface EffectOptions {
  /** Debug name (dev mode only) */
  name?: string;
  /** When true, defers the initial effect execution until the next change */
  defer?: boolean;
}

/** Options for plain signals created with `createSignal(value)` or `createOptimistic(value)`. */
export interface SignalOptions<T> {
  /** Debug name (dev mode only) */
  name?: string;
  /** Custom equality function, or `false` to always notify subscribers */
  equals?: false | ((prev: T, next: T) => boolean);
  /** Suppress dev-mode warnings when writing inside an owned scope */
  pureWrite?: boolean;
  /** Callback invoked when the signal loses all subscribers */
  unobserved?: () => void;
}

/**
 * Options for read-only memos created with `createMemo`.
 * Also used in combination with `SignalOptions` for writable memos
 * (`createSignal(fn)` / `createOptimistic(fn)`).
 */
export interface MemoOptions<T> {
  /** Stable identifier for the owner hierarchy */
  id?: string;
  /** Debug name (dev mode only) */
  name?: string;
  /** Custom equality function, or `false` to always notify subscribers */
  equals?: false | ((prev: T, next: T) => boolean);
  /** Callback invoked when the computed loses all subscribers */
  unobserved?: () => void;
  /** When true, defers the initial computation until the value is first read */
  lazy?: boolean;
}

// Magic type that when used at sites where generic types are inferred from, will prevent those sites from being involved in the inference.
// https://github.com/microsoft/TypeScript/issues/14829
// TypeScript Discord conversation: https://discord.com/channels/508357248330760243/508357248330760249/911266491024949328
export type NoInfer<T extends any> = [T][T extends any ? 0 : never];

/**
 * Creates a simple reactive state with a getter and setter.
 *
 * When called with a plain value, creates a signal with `SignalOptions` (name, equals, pureWrite, unobserved).
 * When called with a function, creates a writable memo with `SignalOptions & MemoOptions` (adds id, lazy).
 *
 * ```typescript
 * // Plain signal
 * const [state, setState] = createSignal<T>(value, options?: SignalOptions<T>);
 * // Writable memo (function overload)
 * const [state, setState] = createSignal<T>(fn, initialValue?, options?: SignalOptions<T> & MemoOptions<T>);
 * ```
 * @param value initial value of the state; if empty, the state's type will automatically extended with undefined
 * @param options optional object with a name for debugging purposes and equals, a comparator function for the previous and next value to allow fine-grained control over the reactivity
 *
 * @returns `[state: Accessor<T>, setState: Setter<T>]`
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-signal
 */
export function createSignal<T>(): Signal<T | undefined>;
export function createSignal<T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
export function createSignal<T>(
  fn: ComputeFunction<T>,
  initialValue?: T,
  options?: SignalOptions<T> & MemoOptions<T>
): Signal<T>;
export function createSignal<T>(
  first?: T | ComputeFunction<T>,
  second?: T | SignalOptions<T>,
  third?: SignalOptions<T> & MemoOptions<T>
): Signal<T | undefined> {
  if (typeof first === "function") {
    const node = computed<T>(first as any, second as any, third);
    return [
      read.bind(null, node as any) as Accessor<T | undefined>,
      setSignal.bind(null, node as any) as Setter<T | undefined>
    ];
  }
  const node = signal<T>(first as any, second as SignalOptions<T>);
  return [
    read.bind(null, node as any) as Accessor<T>,
    setSignal.bind(null, node as any) as Setter<T | undefined>
  ];
}

/**
 * Creates a readonly derived reactive memoized signal.
 *
 * ```typescript
 * const value = createMemo<T>(compute, initialValue?, options?: MemoOptions<T>);
 * ```
 * @param compute a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options `MemoOptions` -- id, name, equals, unobserved, lazy
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-memo
 */
// The extra Prev generic parameter separates inference of the compute input
// parameter type from inference of the compute return type, so that the effect
// return type is always used as the memo Accessor's return type.
export function createMemo<Next extends Prev, Prev = Next>(
  compute: ComputeFunction<undefined | NoInfer<Prev>, Next>
): Accessor<Next>;
export function createMemo<Next extends Prev, Init = Next, Prev = Next>(
  compute: ComputeFunction<Init | Prev, Next>,
  value: Init,
  options?: MemoOptions<Next>
): Accessor<Next>;
export function createMemo<Next extends Prev, Init, Prev>(
  compute: ComputeFunction<Init | Prev, Next>,
  value?: Init,
  options?: MemoOptions<Next>
): Accessor<Next> {
  let node = computed<Next>(compute as any, value as any, options);
  return read.bind(null, node as any) as Accessor<Next>;
}

/**
 * Creates a reactive effect that runs after the render phase.
 *
 * ```typescript
 * createEffect<T>(compute, effectFn | { effect, error }, initialValue?, options?: EffectOptions);
 * ```
 * @param compute a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param effectFn a function that receives the new value and is used to perform side effects (return a cleanup function), or an `EffectBundle` with `effect` and `error` handlers
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options `EffectOptions` -- name, defer
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-effect
 */
export function createEffect<Next>(
  compute: ComputeFunction<undefined | NoInfer<Next>, Next>,
  effectFn: EffectFunction<NoInfer<Next>, Next> | EffectBundle<NoInfer<Next>, Next>
): void;
export function createEffect<Next, Init = Next>(
  compute: ComputeFunction<Init | Next, Next>,
  effect: EffectFunction<Next, Next> | EffectBundle<Next, Next>,
  value: Init,
  options?: EffectOptions
): void;
export function createEffect<Next, Init>(
  compute: ComputeFunction<Init | Next, Next>,
  effectFn: EffectFunction<Next, Next> | EffectBundle<Next, Next>,
  value?: Init,
  options?: EffectOptions
): void {
  effect(
    compute as any,
    (effectFn as any).effect || effectFn,
    (effectFn as any).error,
    value as any,
    __DEV__ ? { ...options, name: options?.name ?? "effect" } : options
  );
}

/**
 * Creates a reactive computation that runs during the render phase as DOM elements
 * are created and updated but not necessarily connected.
 *
 * ```typescript
 * createRenderEffect<T>(compute, effectFn, initialValue?, options?: EffectOptions);
 * ```
 * @param compute a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param effectFn a function that receives the new value and is used to perform side effects
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options `EffectOptions` -- name, defer
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-render-effect
 */
export function createRenderEffect<Next>(
  compute: ComputeFunction<undefined | NoInfer<Next>, Next>,
  effectFn: EffectFunction<NoInfer<Next>, Next>
): void;
export function createRenderEffect<Next, Init = Next>(
  compute: ComputeFunction<Init | Next, Next>,
  effectFn: EffectFunction<Next, Next>,
  value: Init,
  options?: EffectOptions
): void;
export function createRenderEffect<Next, Init>(
  compute: ComputeFunction<Init | Next, Next>,
  effectFn: EffectFunction<Next, Next>,
  value?: Init,
  options?: EffectOptions
): void {
  effect(compute as any, effectFn, undefined, value as any, {
    render: true,
    ...(__DEV__ ? { ...options, name: options?.name ?? "effect" } : options)
  });
}

/**
 * Creates a tracked reactive effect where dependency tracking and side effects happen
 * in the same scope.
 *
 * WARNING: Because tracking and effects happen in the same scope, this primitive
 * may run multiple times for a single change or show tearing (reading inconsistent
 * state). Use only when dynamic subscription patterns require same-scope tracking.
 *
 * ```typescript
 * createTrackedEffect(compute, options?: EffectOptions);
 * ```
 * @param compute a function that contains reactive reads to track and returns an optional cleanup function to run on disposal or before next execution
 * @param options `EffectOptions` -- name, defer
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-tracked-effect
 */
export function createTrackedEffect(
  compute: () => void | (() => void),
  options?: EffectOptions
): void {
  trackedEffect(
    compute,
    __DEV__ ? { ...options, name: options?.name ?? "trackedEffect" } : options
  );
}

/**
 * Creates a reactive computation that runs after the render phase with flexible tracking.
 *
 * ```typescript
 * const track = createReaction(effectFn, options?: EffectOptions);
 * track(() => { // reactive reads });
 * ```
 * @param effectFn a function (or `EffectBundle`) that is called when tracked function is invalidated
 * @param options `EffectOptions` -- name, defer
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-reaction
 */
export function createReaction(
  effectFn: EffectFunction<undefined> | EffectBundle<undefined>,
  options?: EffectOptions
) {
  let cleanup: (() => void) | undefined = undefined;
  onCleanup(() => cleanup?.());
  const owner = getOwner();
  return (tracking: () => void) => {
    runWithOwner(owner!, () => {
      effect(
        () => (tracking(), getOwner()!),
        node => {
          cleanup?.();
          cleanup = ((effectFn as any).effect || effectFn)?.();
          dispose(node as any);
        },
        (effectFn as any).error,
        undefined,
        {
          defer: true,
          ...(__DEV__ ? { ...options, name: options?.name ?? "effect" } : options)
        }
      );
    });
  };
}

/**
 * Returns a promise of the resolved value of a reactive expression
 * @param fn a reactive expression to resolve
 */
export function resolve<T>(fn: () => T): Promise<T> {
  return new Promise((res, rej) => {
    createRoot(dispose => {
      computed(() => {
        try {
          res(fn());
        } catch (err) {
          if (err instanceof NotReadyError) throw err;
          rej(err);
        }
        dispose();
      });
    });
  });
}

/**
 * Creates an optimistic signal that can be used to optimistically update a value
 * and then revert it back to the previous value at end of transition.
 *
 * When called with a plain value, creates an optimistic signal with `SignalOptions` (name, equals, pureWrite, unobserved).
 * When called with a function, creates a writable optimistic memo with `SignalOptions & MemoOptions` (adds id, lazy).
 *
 * ```typescript
 * // Plain optimistic signal
 * const [state, setState] = createOptimistic<T>(value, options?: SignalOptions<T>);
 * // Writable optimistic memo (function overload)
 * const [state, setState] = createOptimistic<T>(fn, initialValue?, options?: SignalOptions<T> & MemoOptions<T>);
 * ```
 * @param value initial value of the signal; if empty, the signal's type will automatically extended with undefined
 * @param options optional object with a name for debugging purposes and equals, a comparator function for the previous and next value to allow fine-grained control over the reactivity
 *
 * @returns `[state: Accessor<T>, setState: Setter<T>]`
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-optimistic-signal
 */
export function createOptimistic<T>(): Signal<T | undefined>;
export function createOptimistic<T>(
  value: Exclude<T, Function>,
  options?: SignalOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  fn: ComputeFunction<T>,
  initialValue?: T,
  options?: SignalOptions<T> & MemoOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  first?: T | ComputeFunction<T>,
  second?: T | SignalOptions<T>,
  third?: SignalOptions<T> & MemoOptions<T>
): Signal<T | undefined> {
  const node =
    typeof first === "function"
      ? optimisticComputed<T>(first as any, second as any, third)
      : optimisticSignal<T>(first as any, second as SignalOptions<T>);
  return [
    read.bind(null, node as any) as Accessor<T | undefined>,
    setSignal.bind(null, node as any) as Setter<T | undefined>
  ];
}

/**
 * Runs a callback after the current flush cycle completes.
 *
 * When called within a reactive context (owner), uses a tracked effect with untracked
 * reads - this means normal signal reads won't create subscriptions, but uninitialized
 * async values will throw NotReadyError, causing the callback to re-run when they settle.
 *
 * When called without an owner, runs once and immediately calls any returned cleanup.
 *
 * @param callback Function to run, may return a cleanup function
 */
export function onSettled(callback: () => void | (() => void)): void {
  getOwner()
    ? createTrackedEffect(() => untrack(callback))
    : globalQueue.enqueue(EFFECT_USER, () => {
        const cleanup = callback();
        cleanup?.();
      });
}
