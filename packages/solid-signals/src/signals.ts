import type { SignalOptions } from "./core/index.js";
import {
  Computation,
  compute,
  EagerComputation,
  Effect,
  ERROR_BIT,
  LOADING_BIT,
  onCleanup,
  Owner,
  UNCHANGED,
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
export function createSignal<T>(
  value: Exclude<T, Function>,
  options?: SignalOptions<T>
): Signal<T>;
export function createSignal<T>(
  fn: (prev?: T) => T,
  initialValue?: T,
  options?: SignalOptions<T>
): Signal<T>;
export function createSignal<T>(
  first?: T | ((prev?: T) => T),
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

export function createAsync<T>(
  fn: (prev?: T) => Promise<T> | AsyncIterable<T> | T,
  initial?: T,
  options?: SignalOptions<T>
): Accessor<T> {
  const lhs = new EagerComputation(
    {
      _value: initial
    } as any,
    (p?: Computation<T>) => {
      const value = p?._value;
      const source = fn(value);
      const isPromise = source instanceof Promise;
      const iterator = source[Symbol.asyncIterator];
      if (!isPromise && !iterator) {
        return {
          wait() {
            return source as T;
          },
          _value: source as T
        };
      }
      const signal = new Computation(value, null, options);
      signal.write(UNCHANGED, LOADING_BIT);
      if (isPromise) {
        source.then(
          value => {
            signal.write(value, 0);
          },
          error => {
            signal.write(error, ERROR_BIT);
          }
        );
      } else {
        let abort = false;
        onCleanup(() => (abort = true));
        (async () => {
          try {
            for await (let value of source as AsyncIterable<T>) {
              if (abort) return;
              signal.write(value, 0);
            }
          } catch (error: any) {
            signal.write(error, ERROR_BIT);
          }
        })();
      }
      return signal;
    }
  );
  return () => lhs.wait().wait();
}

/**
 * Creates a new computation whose value is computed and returned by the given function. The given
 * compute function is _only_ re-run when one of it's dependencies are updated. Dependencies are
 * are all signals that are read during execution.
 */
export function createMemo<T>(
  compute: (prev?: T) => T,
  initialValue?: T,
  options?: SignalOptions<T>
): Accessor<T> {
  let node: Computation<T> | undefined = new Computation(initialValue, compute, options);
  let value: T;
  return () => {
    if (node) {
      value = node.wait();
      if (!node._sources?.length) node = undefined;
    }
    return value;
  };
}

/**
 * Invokes the given function each time any of the signals that are read inside are updated
 * (i.e., their value changes). The effect is immediately invoked on initialization.
 */
export function createEffect<T>(
  compute: () => T,
  effect: (v: T) => (() => void) | void,
  initialValue?: T,
  options?: { name?: string }
): void {
  void new Effect(
    initialValue as any,
    compute,
    effect,
    __DEV__ ? { name: options?.name ?? "effect" } : undefined
  );
}

/**
 * Invokes the given function each time any of the signals that are read inside are updated
 * (i.e., their value changes). The effect is immediately invoked on initialization.
 */
export function createRenderEffect<T>(
  compute: () => T,
  effect: (v: T) => (() => void) | void,
  initialValue?: T,
  options?: { name?: string }
): void {
  void new Effect(initialValue as any, compute, effect, {
    render: true,
    ...(__DEV__ ? { name: options?.name ?? "effect" } : undefined)
  });
}

/**
 * Creates a computation root which is given a `dispose()` function to dispose of all inner
 * computations.
 */
export function createRoot<T>(init: ((dispose: () => void) => T) | (() => T)): T {
  const owner = new Owner();
  return compute(owner, !init.length ? (init as () => T) : () => init(() => owner.dispose()), null);
}

/**
 * Runs the given function in the given owner so that error handling and cleanups continue to work.
 *
 * Warning: Usually there are simpler ways of modeling a problem that avoid using this function
 */
export function runWithOwner<T>(owner: Owner | null, run: () => T): T | undefined {
  try {
    return compute(owner, run, null);
  } catch (error) {
    owner?.handleError(error);
    return undefined;
  }
}

/**
 * Runs the given function when an error is thrown in a child owner. If the error is thrown again
 * inside the error handler, it will trigger the next available parent owner handler.
 */
export function catchError<T>(fn: () => T, handler: (error: unknown) => void): void {
  const owner = new Owner();

  owner._handlers = owner._handlers ? [handler, ...owner._handlers] : [handler];

  try {
    compute(owner, fn, null);
  } catch (error) {
    owner.handleError(error);
  }
}
