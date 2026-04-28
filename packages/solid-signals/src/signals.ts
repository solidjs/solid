import type { Disposable } from "./core/index.js";
import {
  cleanup,
  computed,
  CONFIG_AUTO_DISPOSE,
  CONFIG_CHILDREN_FORBIDDEN,
  createRoot,
  dispose,
  effect,
  EFFECT_USER,
  getObserver,
  getOwner,
  NotReadyError,
  optimisticComputed,
  optimisticSignal,
  read,
  runWithOwner,
  setSignal,
  signal,
  trackedEffect,
  untrack
} from "./core/index.js";
import { emitDiagnostic, registerGraph } from "./core/dev.js";
import { globalQueue } from "./core/scheduler.js";

/**
 * Low-level reactive-cleanup primitive. Registers a callback that runs when
 * the surrounding owner is disposed.
 *
 * **In 2.0 user code this is rare.** The two cases where you might reach for
 * it have better-shaped tools:
 *
 * - **Component lifecycle (mount/unmount, listeners, intervals):** use
 *   {@link onSettled} and **return** a cleanup function. Setup and teardown
 *   stay paired in one block. This replaces the 1.x `onMount` + `onCleanup`
 *   pairing.
 * - **Cleanup tied to an effect run:** `onCleanup` does not belong in
 *   `createEffect`'s apply phase. If a compute phase genuinely needs per-run
 *   teardown, that's usually a sign the work should be a memo/projection
 *   instead, or moved to `onSettled` if it's lifecycle-shaped.
 *
 * Where `onCleanup` is the right tool is **library / custom-primitive
 * internals** — coordinating disposal inside a `createRoot` body, or wiring
 * cleanup to a captured owner via `runWithOwner` from a custom factory.
 * Application code rarely needs to write any of those shapes directly.
 *
 * Must be called inside an owner. Calling outside an owner is a no-op (with a
 * dev-mode warning).
 *
 * Cannot be used inside `createTrackedEffect` or `onSettled` — return a
 * cleanup function from the callback body instead.
 */
export function onCleanup(fn: Disposable): Disposable {
  if (__DEV__) {
    const owner = getOwner();
    if (!owner) {
      const message =
        "[NO_OWNER_CLEANUP] onCleanup called outside a reactive context will never be run";
      emitDiagnostic({
        code: "NO_OWNER_CLEANUP",
        kind: "lifecycle",
        severity: "warn",
        message
      });
      console.warn(message);
    } else if (owner._config & CONFIG_CHILDREN_FORBIDDEN) {
      const message =
        "[CLEANUP_IN_FORBIDDEN_SCOPE] Cannot use onCleanup inside createTrackedEffect or onSettled; return a cleanup function instead";
      emitDiagnostic({
        code: "CLEANUP_IN_FORBIDDEN_SCOPE",
        kind: "lifecycle",
        severity: "error",
        message,
        ownerId: owner.id,
        ownerName: (owner as any)._name
      });
      throw new Error(message);
    }
  }
  return cleanup(fn);
}

/**
 * A zero-arg getter for a reactive value. Calling it inside a tracking scope
 * (memo, effect compute, JSX expression) subscribes the scope to changes.
 *
 * Reading outside any tracking scope simply returns the current value without
 * creating a subscription.
 */
export type Accessor<T> = () => T;

export function accessor<T>(node: any): Accessor<T> {
  return read.bind(null, node) as Accessor<T>;
}

/**
 * A signal setter. Accepts either a new value or an updater `(prev) => next`.
 *
 * If the type permits `undefined`, `setState()` (no args) clears to `undefined`.
 *
 * To store a function as the value itself (rather than as an updater), wrap it
 * with an updater: `setHandler(() => myHandler)`.
 */
export type Setter<in out T> = {
  <U extends T>(
    ...args: undefined extends T ? [] : [value: Exclude<U, Function> | ((prev: T) => U)]
  ): undefined extends T ? undefined : U;
  <U extends T>(value: (prev: T) => U): U;
  <U extends T>(value: Exclude<U, Function>): U;
  <U extends T>(value: Exclude<U, Function> | ((prev: T) => U)): U;
};

/** A `[get, set]` pair returned from `createSignal` / `createOptimistic`. */
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

/** Options shared by every effect primitive. */
interface BaseEffectOptions {
  /** Debug name (dev mode only) */
  name?: string;
}

/** Options for effect primitives that support deferring/scheduling their initial run (`createEffect`, `createRenderEffect`, `createReaction`). */
export interface EffectOptions extends BaseEffectOptions {
  /** When true, defers the initial effect execution until the next change */
  defer?: boolean;
  /**
   * When true, enqueues the initial effect callback through the effect queue instead of running
   * it synchronously at creation. Lets the initial run participate in transitions -- if any
   * source throws `NotReadyError` during the compute phase, the callback is held until the
   * transition settles.
   *
   * Primarily for render effects that need transition-aware initial mounts (e.g. the root
   * `insert()` in `render()`).
   */
  schedule?: boolean;
}

/** Options for plain signals created with `createSignal(value)` or `createOptimistic(value)`. */
export interface SignalOptions<T> {
  /** Debug name (dev mode only) */
  name?: string;
  /** Custom equality function, or `false` to always notify subscribers */
  equals?: false | ((prev: T, next: T) => boolean);
  /** Suppress dev-mode warnings when writing inside an owned scope */
  ownedWrite?: boolean;
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
  /** When true, the owner is invisible to the ID scheme -- inherits parent ID and doesn't consume a childCount slot */
  transparent?: boolean;
  /** Custom equality function, or `false` to always notify subscribers */
  equals?: false | ((prev: T, next: T) => boolean);
  /** Callback invoked when the computed loses all subscribers */
  unobserved?: () => void;
  /**
   * When true, defers the initial computation until the value is first read,
   * **and** opts the memo into autodisposal — once it has no remaining
   * subscribers it is torn down and recomputed from scratch on the next read.
   * Use it for compute-on-demand values that should not retain state across
   * idle periods. Non-lazy owned memos live for their owner's lifetime and
   * never autodispose.
   */
  lazy?: boolean;
}

// Magic type that when used at sites where generic types are inferred from, will prevent those sites from being involved in the inference.
// https://github.com/microsoft/TypeScript/issues/14829
// TypeScript Discord conversation: https://discord.com/channels/508357248330760243/508357248330760249/911266491024949328
export type NoInfer<T extends any> = [T][T extends any ? 0 : never];

/**
 * Creates a simple reactive state with a getter and setter.
 *
 * When called with a plain value, creates a signal with `SignalOptions` (name, equals, ownedWrite, unobserved).
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
 * @example
 * ```ts
 * const [count, setCount] = createSignal(0);
 *
 * count();              // 0
 * setCount(1);          // explicit value
 * setCount(c => c + 1); // updater
 * ```
 *
 * @example
 * ```ts
 * // Writable memo: starts as `fn()`, can be locally overwritten by setter.
 * const [user, setUser] = createSignal(() => fetchUser(userId()));
 *
 * setUser({ ...user(), name: "Alice" }); // optimistic local edit
 * ```
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-signal
 */
export function createSignal<T>(): Signal<T | undefined>;
export function createSignal<T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
export function createSignal<T>(
  fn: ComputeFunction<T>,
  options?: SignalOptions<T> & MemoOptions<T>
): Signal<T>;
export function createSignal<T>(
  first?: T | ComputeFunction<T>,
  second?: SignalOptions<T> & MemoOptions<T>
): Signal<T | undefined> {
  if (typeof first === "function") {
    const node = computed<T>(first as any, second as any);
    node._config &= ~CONFIG_AUTO_DISPOSE;
    return [
      accessor<T | undefined>(node),
      setSignal.bind(null, node as any) as Setter<T | undefined>
    ];
  }
  const node = signal<T>(first as any, second as SignalOptions<T>);
  if (__DEV__) registerGraph(node, getOwner());
  return [accessor<T>(node), setSignal.bind(null, node as any) as Setter<T | undefined>];
}

/**
 * Creates a readonly derived reactive memoized signal.
 *
 * ```typescript
 * const value = createMemo<T>(compute, options?: MemoOptions<T>);
 * ```
 * @param compute a function that receives its previous value and returns a new value used to react on a computation
 * @param options `MemoOptions` -- id, name, equals, unobserved, lazy
 *
 * @example
 * ```ts
 * const [first, setFirst] = createSignal("Ada");
 * const [last, setLast] = createSignal("Lovelace");
 *
 * const fullName = createMemo(() => `${first()} ${last()}`);
 *
 * fullName(); // "Ada Lovelace"
 * ```
 *
 * @example
 * ```ts
 * // Async memo — reads surface as pending inside <Loading>
 * const user = createMemo(async () => {
 *   const res = await fetch(`/users/${id()}`);
 *   return res.json();
 * });
 * ```
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-memo
 */
// NoInfer keeps the previous-value parameter from influencing T inference, so
// the memo/effect result type is still driven by the compute return type.
export function createMemo<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  options?: MemoOptions<T>
): Accessor<T> {
  return accessor<T>(computed<T>(compute as any, options));
}

/**
 * Creates a reactive effect with **separate compute and effect phases**.
 *
 * - `compute(prev)` runs reactively — *put all reactive reads here*. The
 *   returned value is passed to `effect` and is also the new "previous" value
 *   for the next run.
 * - `effect(next, prev?)` runs imperatively (untracked) after the queue
 *   flushes. *Put DOM writes / fetch / logging / subscriptions here.* It may
 *   return a cleanup function which runs before the next effect or on
 *   disposal.
 *
 * Reactive reads inside `effect` will *not* re-trigger this effect — that's
 * intentional. If you need a single-phase tracked effect, use
 * `createTrackedEffect` (with the tradeoffs noted there).
 *
 * Pass an `EffectBundle` (`{ effect, error }`) instead of a plain function to
 * intercept errors thrown from the compute or effect phases.
 *
 * ```typescript
 * createEffect<T>(compute, effectFn | { effect, error }, options?: EffectOptions);
 * ```
 * @param compute a function that receives its previous value and returns a new value used to react on a computation
 * @param effectFn a function that receives the new value and is used to perform side effects (return a cleanup function), or an `EffectBundle` with `effect` and `error` handlers
 * @param options `EffectOptions` -- name, defer, schedule
 *
 * @example
 * ```ts
 * const [count, setCount] = createSignal(0);
 *
 * createEffect(
 *   () => count(),                  // compute: tracks `count`
 *   value => console.log(value)     // effect: side effect
 * );
 *
 * setCount(1); // logs 1 after the next flush
 * ```
 *
 * @example
 * ```ts
 * createEffect(
 *   () => userId(),
 *   id => {
 *     const ctrl = new AbortController();
 *     fetch(`/users/${id}`, { signal: ctrl.signal });
 *     return () => ctrl.abort(); // cleanup before next run / disposal
 *   }
 * );
 * ```
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-effect
 */
export function createEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effectFn: EffectFunction<NoInfer<T>, T> | EffectBundle<NoInfer<T>, T>,
  options?: EffectOptions
): void;
/**
 * @deprecated `createEffect(compute)` (single argument) is no longer supported.
 * Pass a separate effect function as the second argument:
 * `createEffect(compute, effect)`. See [MISSING_EFFECT_FN].
 *
 * - For a side effect that reacts to changes, split the work:
 *   `createEffect(() => signal(), value => doWork(value))`.
 * - For a derived value, use `createMemo(() => signal())`.
 * - For a one-shot side effect at construction time, just call the function.
 */
export function createEffect<T>(compute: ComputeFunction<undefined | NoInfer<T>, T>): never;
export function createEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effectFn?: EffectFunction<NoInfer<T>, T> | EffectBundle<NoInfer<T>, T>,
  options?: EffectOptions
): void {
  if (__DEV__ && effectFn === undefined) {
    const message =
      "[MISSING_EFFECT_FN] createEffect requires both a compute function and an effect function. " +
      "Use `createEffect(() => signal(), value => doWork(value))`. " +
      "If you want a derived value, use `createMemo`. " +
      "If you want a one-shot side effect, just call the function directly.";
    emitDiagnostic({
      code: "MISSING_EFFECT_FN",
      kind: "lifecycle",
      severity: "error",
      message
    });
    throw new Error(message);
  }
  effect(compute as any, (effectFn as any).effect || effectFn, (effectFn as any).error, {
    user: true,
    ...(__DEV__ ? { ...options, name: options?.name ?? "effect" } : options)
  });
}

/**
 * Creates a reactive computation that runs during the render phase as DOM elements
 * are created and updated but not necessarily connected.
 *
 * ```typescript
 * createRenderEffect<T>(compute, effectFn, options?: EffectOptions);
 * ```
 * @param compute a function that receives its previous value and returns a new value used to react on a computation
 * @param effectFn a function that receives the new value and is used to perform side effects
 * @param options `EffectOptions` -- name, defer, schedule
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-render-effect
 */
export function createRenderEffect<T>(
  compute: ComputeFunction<undefined | NoInfer<T>, T>,
  effectFn: EffectFunction<NoInfer<T>, T>,
  options?: EffectOptions
): void {
  effect(
    compute as any,
    effectFn,
    undefined,
    __DEV__ ? { ...options, name: options?.name ?? "effect" } : options
  );
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
 * createTrackedEffect(compute, options?: { name?: string });
 * ```
 * @param compute a function that contains reactive reads to track and returns an optional cleanup function to run on disposal or before next execution
 * @param options -- name
 *
 * @example
 * ```ts
 * createTrackedEffect(() => {
 *   const target = focusedNode();
 *   if (!target) return;
 *
 *   const handler = () => log(target.value());
 *   target.on("change", handler);
 *
 *   return () => target.off("change", handler);
 * });
 * ```
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-tracked-effect
 */
export function createTrackedEffect(
  compute: () => void | (() => void),
  options?: BaseEffectOptions
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
 * @example
 * ```ts
 * const [count, setCount] = createSignal(0);
 *
 * const track = createReaction(() => {
 *   console.log("count changed once, re-arm to listen again");
 *   track(() => count()); // re-arm
 * });
 *
 * track(() => count()); // initial arm
 *
 * setCount(1); // logs once, reaction re-armed for next change
 * ```
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-reaction
 */
export function createReaction(
  effectFn: EffectFunction<undefined> | EffectBundle<undefined>,
  options?: EffectOptions
) {
  let cl: (() => void) | undefined = undefined;
  cleanup(() => cl?.());
  const owner = getOwner();
  return (tracking: () => void) => {
    runWithOwner(owner!, () => {
      effect(
        () => (tracking(), getOwner()!),
        node => {
          cl?.();
          const cleanup = ((effectFn as any).effect || effectFn)?.();
          if (__DEV__ && cleanup !== undefined && typeof cleanup !== "function") {
            throw new Error(
              "Reaction callback returned an invalid cleanup value. Return a cleanup function or undefined."
            );
          }
          cl = cleanup as (() => void) | undefined;
          dispose(node as any);
        },
        (effectFn as any).error,
        {
          ...(__DEV__ ? { ...options, name: options?.name ?? "effect" } : options),
          user: true,
          defer: true
        }
      );
    });
  };
}

/**
 * Awaits a reactive expression and returns its first fully-settled value as a
 * `Promise`. Pending async reads (`createMemo` returning a promise, etc.) are
 * waited on; once the expression returns synchronously without `NotReadyError`
 * the promise resolves with that value.
 *
 * Must be called *outside* a tracking scope — it doesn't subscribe, it just
 * resolves the current value once.
 *
 * @example
 * ```ts
 * const user = createMemo(() => fetch(`/users/${id()}`).then(r => r.json()));
 *
 * // outside any reactive scope
 * const initial = await resolve(() => user());
 * ```
 *
 * @param fn a reactive expression to resolve
 */
export function resolve<T>(fn: () => T): Promise<T> {
  if (__DEV__ && getObserver()) {
    throw new Error(
      "Cannot call resolve inside a reactive scope; it only resolves the current value and does not track updates."
    );
  }
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
 * When called with a plain value, creates an optimistic signal with `SignalOptions` (name, equals, ownedWrite, unobserved).
 * When called with a function, creates a writable optimistic memo with `SignalOptions & MemoOptions` (adds id, lazy).
 *
 * ```typescript
 * // Plain optimistic signal
 * const [state, setState] = createOptimistic<T>(value, options?: SignalOptions<T>);
 * // Writable optimistic memo (function overload)
 * const [state, setState] = createOptimistic<T>(fn, options?: SignalOptions<T> & MemoOptions<T>);
 * ```
 * @param value initial value of the signal; if empty, the signal's type will automatically extended with undefined
 * @param options optional object with a name for debugging purposes and equals, a comparator function for the previous and next value to allow fine-grained control over the reactivity
 *
 * @returns `[state: Accessor<T>, setState: Setter<T>]`
 *
 * @example
 * ```ts
 * const [todos, setTodos] = createOptimistic(initialTodos);
 *
 * const addTodo = action(function* (text: string) {
 *   const tempId = crypto.randomUUID();
 *   setTodos(t => [...t, { id: tempId, text, pending: true }]); // optimistic
 *   const saved = yield api.createTodo(text);
 *   setTodos(t => t.map(x => (x.id === tempId ? saved : x)));   // reconcile
 * });
 * ```
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
  options?: SignalOptions<T> & MemoOptions<T>
): Signal<T>;
export function createOptimistic<T>(
  first?: T | ComputeFunction<T>,
  second?: SignalOptions<T> & MemoOptions<T>
): Signal<T | undefined> {
  if (typeof first === "function") {
    const node = optimisticComputed<T>(first as any, second as any);
    node._config &= ~CONFIG_AUTO_DISPOSE;
    return [
      accessor<T | undefined>(node),
      setSignal.bind(null, node as any) as Setter<T | undefined>
    ];
  }
  const node = optimisticSignal<T>(first as any, second as SignalOptions<T>);
  if (__DEV__) registerGraph(node, getOwner());
  return [
    accessor<T | undefined>(node),
    setSignal.bind(null, node as any) as Setter<T | undefined>
  ];
}

/**
 * Schedules `callback` to run **once** after the reactive graph has fully
 * settled — i.e. once every pending async read inside the current owner has
 * resolved and the queue has flushed. Each call registers a single fire; it
 * does not create an ongoing subscription.
 *
 * The canonical lifecycle primitive in 2.0. Three main usages:
 *
 * - **Component-level setup-and-teardown** *(the most common shape)*: run
 *   setup after the component's first stable render and **return a cleanup
 *   function** to dispose it on owner disposal. This is the replacement for
 *   the 1.x `onMount` + `onCleanup` pairing — setup and teardown live in one
 *   block, and `onCleanup` is no longer the right tool for component
 *   bodies. (`onMount` no longer exists in 2.0.)
 * - **Post-settle "ready" hook:** run once after a component's first stable
 *   render — analytics ping, focus, scroll-into-view, etc. No cleanup needed.
 * - **Inside an event handler:** schedule work to run after the action /
 *   transition triggered by the event has completed.
 *
 * Reactive reads inside the callback are *not* tracked — to react to
 * subsequent settles, register a new `onSettled` each time.
 *
 * `onCleanup` is **not** allowed inside the callback — return a cleanup
 * function instead. The returned cleanup runs on owner disposal.
 *
 * @example
 * ```tsx
 * // Component-level setup + teardown — replaces onMount + onCleanup.
 * // Subscribe to an external source on mount, unsubscribe on dispose.
 * function useViewportWidth() {
 *   const [width, setWidth] = createSignal(window.innerWidth);
 *   onSettled(() => {
 *     const onResize = () => setWidth(window.innerWidth);
 *     window.addEventListener("resize", onResize);
 *     return () => window.removeEventListener("resize", onResize);
 *   });
 *   return width;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Post-settle "ready" hook — no cleanup needed.
 * function Dashboard() {
 *   const data = createMemo(async () => fetchData());
 *
 *   onSettled(() => {
 *     analytics.track("dashboard.ready");
 *   });
 *
 *   return <Loading fallback={<Spinner />}><pre>{data()}</pre></Loading>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Event-handler — runs after the action settles.
 * function SaveButton() {
 *   const save = action(function* () {
 *     yield api.save();
 *   });
 *
 *   const handleClick = () => {
 *     save();
 *     onSettled(() => toast("Saved!"));
 *   };
 *
 *   return <button onClick={handleClick}>Save</button>;
 * }
 * ```
 *
 * @param callback Function to run; may return a cleanup function that fires
 *   on owner disposal
 */
export function onSettled(callback: () => void | (() => void)): void {
  const owner = getOwner();
  owner && !(owner._config & CONFIG_CHILDREN_FORBIDDEN)
    ? createTrackedEffect(() => untrack(callback), __DEV__ ? { name: "onSettled" } : undefined)
    : globalQueue.enqueue(EFFECT_USER, () => {
        const cleanup = callback();
        if (__DEV__ && cleanup !== undefined && typeof cleanup !== "function") {
          throw new Error(
            "onSettled callback returned an invalid cleanup value. Return a cleanup function or undefined."
          );
        }
        cleanup?.();
      });
}
