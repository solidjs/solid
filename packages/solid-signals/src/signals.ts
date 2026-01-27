import type { Computed, SignalOptions } from "./core/index.js";
import {
  computed,
  createRoot,
  dispose,
  effect,
  EFFECT_USER,
  getOwner,
  NotReadyError,
  onCleanup,
  read,
  runWithOwner,
  setSignal,
  signal,
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
) => Promise<Next> | AsyncIterable<Next> | Next;
export type EffectFunction<Prev, Next extends Prev = Prev> = (
  v: Next,
  p?: Prev
) => (() => void) | void;
export type EffectBundle<Prev, Next extends Prev = Prev> = {
  effect: EffectFunction<Prev, Next>;
  error: (err: unknown, cleanup: () => void) => void;
};

export interface EffectOptions {
  name?: string;
  defer?: boolean;
}
export interface MemoOptions<T> {
  name?: string;
  equals?: false | ((prev: T, next: T) => boolean);
}

// Magic type that when used at sites where generic types are inferred from, will prevent those sites from being involved in the inference.
// https://github.com/microsoft/TypeScript/issues/14829
// TypeScript Discord conversation: https://discord.com/channels/508357248330760243/508357248330760249/911266491024949328
export type NoInfer<T extends any> = [T][T extends any ? 0 : never];

/**
 * Creates a simple reactive state with a getter and setter
 * ```typescript
 * const [state: Accessor<T>, setState: Setter<T>] = createSignal<T>(
 *  value: T,
 *  options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * )
 * ```
 * @param value initial value of the state; if empty, the state's type will automatically extended with undefined; otherwise you need to extend the type manually if you want setting to undefined not be an error
 * @param options optional object with a name for debugging purposes and equals, a comparator function for the previous and next value to allow fine-grained control over the reactivity
 *
 * @returns ```typescript
 * [state: Accessor<T>, setState: Setter<T>]
 * ```
 * * the Accessor is a function that returns the current value and registers each call to the reactive root
 * * the Setter is a function that allows directly setting or mutating the value:
 * ```typescript
 * const [count, setCount] = createSignal(0);
 * setCount(count => count + 1);
 * ```
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-signal
 */
export function createSignal<T>(): Signal<T | undefined>;
export function createSignal<T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
export function createSignal<T>(
  fn: ComputeFunction<T>,
  initialValue?: T,
  options?: SignalOptions<T>
): Signal<T>;
export function createSignal<T>(
  first?: T | ComputeFunction<T>,
  second?: T | SignalOptions<T>,
  third?: SignalOptions<T>
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
 * Creates a readonly derived reactive memoized signal
 * ```typescript
 * export function createMemo<T>(
 *   compute: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): () => T;
 * ```
 * @param compute a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes and use a custom comparison function in equals
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
 * Creates a reactive effect that runs after the render phase
 * ```typescript
 * export function createEffect<T>(
 *   compute: (prev: T) => T,
 *   effect: (v: T, prev: T) => (() => void) | void,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param compute a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param effect a function that receives the new value and is used to perform side effects, return a cleanup function to run on disposal
 * @param error an optional function that receives an error if thrown during the computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
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
  void effect(
    compute as any,
    (effectFn as any).effect || effectFn,
    (effectFn as any).error,
    value as any,
    __DEV__ ? { ...options, name: options?.name ?? "effect" } : options
  );
}

/**
 * Creates a reactive computation that runs during the render phase as DOM elements are created and updated but not necessarily connected
 * ```typescript
 * export function createRenderEffect<T>(
 *   compute: (prev: T) => T,
 *   effect: (v: T, prev: T) => (() => void) | void,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param compute a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param effect a function that receives the new value and is used to perform side effects
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
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
  void effect(compute as any, effectFn, undefined, value as any, {
    render: true,
    ...(__DEV__ ? { ...options, name: options?.name ?? "effect" } : options)
  });
}

/**
 * Creates a tracked reactive effect that only tracks dependencies inside the effect itself
 * ```typescript
 * export function createTrackedEffect(
 *   compute: () => (() => void) | void,
 *   options?: { name?: string, defer?: boolean }
 * ): void;
 * ```
 * @param compute a function that contains reactive reads to track and returns an optional cleanup function to run on disposal or before next execution
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-tracked-effect
 */
export function createTrackedEffect(
  compute: () => void | (() => void),
  options?: EffectOptions
): void {
  // void new TrackedEffect(compute, options);
}

/**
 * Creates a reactive computation that runs after the render phase with flexible tracking
 * ```typescript
 * export function createReaction(
 *   onInvalidate: () => void,
 *   options?: { name?: string }
 * ): (fn: () => void) => void;
 * ```
 * @param invalidated a function that is called when tracked function is invalidated.
 * @param options allows to set a name in dev mode for debugging purposes
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

export function createOptimistic<T>(): Signal<T | undefined>;
export function createOptimistic<T>(
  value: Exclude<T, Function>,
  options?: SignalOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  fn: ComputeFunction<T>,
  initialValue?: T,
  options?: SignalOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  first?: T | ComputeFunction<T>,
  second?: T | SignalOptions<T>,
  third?: SignalOptions<T>
): Signal<T | undefined> {
  return createSignal<any>(first as any, second as any, third);
  // TODO: re-enable optimistic signals
  // if (typeof first === "function") {
  //   const node = computed<T>(
  //     prev => {
  //       const n = getOwner() as Computed<T>;
  //       const value = (first as any)(prev);
  //       if (n._statusFlags & STATUS_UNINITIALIZED) return value;
  //       n._pendingValue = value;
  //       return prev;
  //     },
  //     second as any,
  //     third
  //   );
  //   node._optimistic = true;
  //   return [
  //     read.bind(null, node as any) as Accessor<T | undefined>,
  //     setSignal.bind(null, node as any) as Setter<T | undefined>
  //   ];
  // }
  // const node = signal<T>(first as any, second as SignalOptions<T>);
  // node._optimistic = true;
  // return [
  //   read.bind(null, node as any) as Accessor<T>,
  //   (v => {
  //     node._pendingValue = first as any;
  //     return setSignal(node as any, v);
  //   }) as Setter<T | undefined>
  // ];
}

export function onSettled(callback: () => void | (() => void)): void {
  let cleanup;
  const o = getOwner();
  if (o) onCleanup(() => cleanup?.());
  globalQueue.enqueue(EFFECT_USER, () => {
    cleanup = callback();
    !o && cleanup?.();
  });
}
