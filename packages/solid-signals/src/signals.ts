import { STATE_DIRTY, STATE_DISPOSED } from "./core/constants.js";
import type { SignalOptions } from "./core/index.js";
import {
  Computation,
  compute,
  EagerComputation,
  Effect,
  ERROR_BIT,
  flatten,
  incrementClock,
  NotReadyError,
  onCleanup,
  Owner,
  untrack
} from "./core/index.js";

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

export type ComputeFunction<Prev, Next extends Prev = Prev> = (v: Prev) => Next;
export type EffectFunction<Prev, Next extends Prev = Prev> = (
  v: Next,
  p?: Prev
) => (() => void) | void;

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
    const memo = createMemo<Signal<T>>(p => {
      const node = new Computation<T>(
        (first as (prev?: T) => T)(p ? untrack(p[0]) : (second as T)),
        null,
        third
      );
      return [node.read.bind(node), node.write.bind(node)] as Signal<T>;
    });
    return [() => memo()[0](), (value => memo()[1](value)) as Setter<T | undefined>];
  }
  const node = new Computation(first, null, second as SignalOptions<T>);
  return [node.read.bind(node), node.write.bind(node) as Setter<T | undefined>];
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
  let node: Computation<Next> | undefined = new Computation<Next>(
    value as any,
    compute as any,
    options
  );
  let resolvedValue: Next;
  return () => {
    if (node) {
      if (node._state === STATE_DISPOSED) {
        node = undefined;
        return resolvedValue;
      }
      resolvedValue = node.wait();
      // no sources so will never update so can be disposed.
      // additionally didn't create nested reactivity so can be disposed.
      if (!node._sources?.length && node._nextSibling?._parent !== node) {
        node.dispose();
        node = undefined;
      }
    }
    return resolvedValue;
  };
}

/**
 * Creates a readonly derived async reactive memoized signal
 * ```typescript
 * export function createAsync<T>(
 *   compute: (v: T) => Promise<T> | T,
 *   value?: T,
 *   options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): () => T;
 * ```
 * @param compute a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes and use a custom comparison function in equals
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-async
 */
export function createAsync<T>(
  compute: (prev?: T) => Promise<T> | AsyncIterable<T> | T,
  value?: T,
  options?: MemoOptions<T>
): Accessor<T> {
  const node = new EagerComputation(value as T, (p?: T) => {
    const source = compute(p);
    const isPromise = source instanceof Promise;
    const iterator = source[Symbol.asyncIterator];
    if (!isPromise && !iterator) {
      return source as T;
    }
    let abort = false;
    onCleanup(() => (abort = true));
    if (isPromise) {
      source.then(
        value3 => {
          if (abort) return;
          node.write(value3, 0, true);
        },
        error => {
          if (abort) return;
          node._setError(error);
        }
      );
    } else {
      (async () => {
        try {
          for await (let value3 of source as AsyncIterable<T>) {
            if (abort) return;
            node.write(value3, 0, true);
          }
        } catch (error: any) {
          if (abort) return;
          node.write(error, ERROR_BIT);
        }
      })();
    }
    throw new NotReadyError();
  }, options);
  return node.wait.bind(node) as Accessor<T>;
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
  effect: EffectFunction<NoInfer<Next>, Next>,
  error?: (err: unknown) => void
): void;
export function createEffect<Next, Init = Next>(
  compute: ComputeFunction<Init | Next, Next>,
  effect: EffectFunction<Next, Next>,
  error: ((err: unknown) => void) | undefined,
  value: Init,
  options?: EffectOptions
): void;
export function createEffect<Next, Init>(
  compute: ComputeFunction<Init | Next, Next>,
  effect: EffectFunction<Next, Next>,
  error?: (err: unknown) => void,
  value?: Init,
  options?: EffectOptions
): void {
  void new Effect(
    value as any,
    compute as any,
    effect,
    error,
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
  effect: EffectFunction<NoInfer<Next>, Next>
): void;
export function createRenderEffect<Next, Init = Next>(
  compute: ComputeFunction<Init | Next, Next>,
  effect: EffectFunction<Next, Next>,
  value: Init,
  options?: EffectOptions
): void;
export function createRenderEffect<Next, Init>(
  compute: ComputeFunction<Init | Next, Next>,
  effect: EffectFunction<Next, Next>,
  value?: Init,
  options?: EffectOptions
): void {
  void new Effect(value as any, compute as any, effect, undefined, {
    render: true,
    ...(__DEV__ ? { ...options, name: options?.name ?? "effect" } : options)
  });
}

/**
 * Creates a new non-tracked reactive context with manual disposal
 *
 * @param fn a function in which the reactive state is scoped
 * @returns the output of `fn`.
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/create-root
 */
export function createRoot<T>(
  init: ((dispose: () => void) => T) | (() => T),
  options?: { id: string }
): T {
  const owner = new Owner(options?.id);
  return compute(owner, !init.length ? (init as () => T) : () => init(() => owner.dispose()), null);
}

/**
 * Runs the given function in the given owner to move ownership of nested primitives and cleanups.
 * This method untracks the current scope.
 *
 * Warning: Usually there are simpler ways of modeling a problem that avoid using this function
 */
export function runWithOwner<T>(owner: Owner | null, run: () => T): T {
  return compute(owner, run, null);
}

/**
 * Switches to fallback whenever an error is thrown within the context of the child scopes
 * @param fn boundary for the error
 * @param fallback an error handler that receives the error
 *
 * * If the error is thrown again inside the error handler, it will trigger the next available parent handler
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/catch-error
 */
export function createErrorBoundary<T, U>(
  fn: () => T,
  fallback: (error: unknown, reset: () => void) => U
): Accessor<T | U> {
  const owner = new Owner();
  const error = new Computation<{ _error: any } | undefined>(undefined, null);
  const nodes = new Set<Owner>();
  function handler(err: unknown, node: Owner) {
    if (nodes.has(node)) return;
    compute(
      node,
      () =>
        onCleanup(() => {
          nodes.delete(node);
          if (!nodes.size) error.write(undefined);
        }),
      null
    );
    nodes.add(node);
    if (nodes.size === 1) error.write({ _error: err });
  }
  owner.addErrorHandler(handler);
  const guarded = compute(
    owner,
    () => {
      const c = new Computation(undefined, fn);
      const f = new EagerComputation(undefined, () => flatten(c.read()), { defer: true });
      f._setError = function (error) {
        this.handleError(error);
      };
      return f;
    },
    null
  );
  const decision = new Computation(null, () => {
    if (!error.read()) {
      const resolved = guarded.read();
      if (!error.read()) return resolved;
    }
    return fallback(error.read()!._error, () => {
      incrementClock();
      for (let node of nodes) {
        (node as any)._state = STATE_DIRTY;
        (node as any)._queue?.enqueue((node as any)._type, node);
      }
    });
  });
  return decision.read.bind(decision);
}

/**
 * Returns a promise of the resolved value of a reactive expression
 * @param fn a reactive expression to resolve
 */
export function resolve<T>(fn: () => T): Promise<T> {
  return new Promise((res, rej) => {
    createRoot(dispose => {
      new EagerComputation(undefined, () => {
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
