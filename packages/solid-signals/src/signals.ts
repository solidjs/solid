import type { SignalOptions } from './core';
import { Computation, compute, UNCHANGED, untrack } from './core';
import { Effect, RenderEffect } from './effect';
import { ERROR_BIT, LOADING_BIT } from './flags';
import { onCleanup, Owner } from './owner';

export interface Accessor<T> {
  (): T;
}

export interface Setter<T> {
  (value: T | SetValue<T>): T;
}

export interface SetValue<T> {
  (currentValue: T): T;
}

export type Signal<T> = [read: Accessor<T>, write: Setter<T>];

/**
 * Wraps the given value into a signal. The signal will return the current value when invoked
 * `fn()`, and provide a simple write API via `write()`. The value can now be observed
 * when used inside other computations created with `computed` and `effect`.
 */
export function createSignal<T>(
  initialValue: Exclude<T, Function>,
  options?: SignalOptions<T>,
): Signal<T>;
export function createSignal<T>(
  fn: (prev?: T) => T,
  initialValue?: T,
  options?: SignalOptions<T>,
): Signal<T>;
export function createSignal<T>(
  first: T | ((prev?: T) => T),
  second?: T | SignalOptions<T>,
  third?: SignalOptions<T>,
): Signal<T> {
  if (typeof first === 'function') {
    const memo = createMemo<Signal<T>>((p) => {
      const node = new Computation<T>(
        (first as (prev?: T) => T)(p ? untrack(p[0]) : (second as T)),
        null,
        third,
      );
      return [node.read.bind(node), node.write.bind(node)];
    });
    return [() => memo()[0](), (value) => memo()[1](value)];
  }
  const node = new Computation(first as T, null, second as SignalOptions<T>);
  return [node.read.bind(node), node.write.bind(node)];
}

export function createAsync<T>(
  fn: (prev?: T) => Promise<T> | AsyncIterable<T> | T,
  initial?: T,
  options?: SignalOptions<T>,
): Accessor<T> {
  const lhs = createMemo(() => {
    const source = fn(initial);
    const isPromise = source instanceof Promise;
    const iterator = source[Symbol.asyncIterator];
    if (!isPromise && !iterator) {
      return {
        wait() {
          return source as T;
        },
      };
    }
    const signal = new Computation(initial, null, options);
    signal.write(UNCHANGED, LOADING_BIT);
    if (isPromise) {
      source.then(
        (value) => {
          signal.write(value, 0);
        },
        (error) => {
          signal.write(error, ERROR_BIT);
        },
      );
    } else {
      let abort = false;
      onCleanup(() => abort = true);
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
  });
  untrack(lhs);
  return () => lhs().wait();
}

/**
 * Creates a new computation whose value is computed and returned by the given function. The given
 * compute function is _only_ re-run when one of it's dependencies are updated. Dependencies are
 * are all signals that are read during execution.
 */
export function createMemo<T>(
  compute: (prev?: T) => T,
  initialValue?: T,
  options?: SignalOptions<T>,
): Accessor<T> {
  let node: Computation<T> | undefined = new Computation(
    initialValue,
    compute,
    options,
  );
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
  options?: { name?: string },
): void {
  void new Effect(
    initialValue as any,
    compute,
    effect,
    __DEV__ ? { name: options?.name ?? 'effect' } : undefined,
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
  options?: { name?: string },
): void {
  void new RenderEffect(
    initialValue as any,
    compute,
    effect,
    __DEV__ ? { name: options?.name ?? 'effect' } : undefined,
  );
}

/**
 * Creates a computation root which is given a `dispose()` function to dispose of all inner
 * computations.
 */
export function createRoot<T>(
  init: ((dispose: () => void) => T) | (() => T),
): T {
  const owner = new Owner();
  return compute(
    owner,
    !init.length ? (init as () => T) : () => init(() => owner.dispose()),
    null,
  );
}

/**
 * Runs the given function in the given owner so that error handling and cleanups continue to work.
 *
 * Warning: Usually there are simpler ways of modeling a problem that avoid using this function
 */
export function runWithOwner<T>(
  owner: Owner | null,
  run: () => T,
): T | undefined {
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
export function catchError<T>(
  fn: () => T,
  handler: (error: unknown) => void,
): void {
  const owner = new Owner();

  owner._handlers = owner._handlers ? [handler, ...owner._handlers] : [handler];

  try {
    compute(owner, fn, null);
  } catch (error) {
    owner.handleError(error);
  }
}
