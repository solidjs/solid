import { NotReadyError, Owner, runWithOwner } from "@solidjs/signals";

export { runWithOwner, onCleanup } from "@solidjs/signals";

import type {
  Accessor,
  Computation,
  ComputeFunction,
  EffectFunction,
  EffectOptions,
  MemoOptions,
  Setter,
  Signal,
  SignalOptions
} from "@solidjs/signals";

let Observer: Computation | null = null;

function run<T>(ownerObserver: Owner, fn: () => T) {
  const prevObserver = Observer;
  Observer = ownerObserver as any;
  try {
    return runWithOwner(ownerObserver, fn);
  } finally {
    Observer = prevObserver;
  }
}

export function createRoot<T>(fn: ((dispose: () => void) => T) | (() => T)): T {
  const owner = new Owner();
  return runWithOwner(owner, !fn.length ? (fn as () => T) : () => fn(() => owner.dispose()));
}

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
      let value = (first as (prev?: T) => T)(p ? p[0]() : (second as T));
      return [
        () => value,
        v => {
          return ((value as any) = typeof v === "function" ? (v as (prev: T) => T)(first as T) : v);
        }
      ] as Signal<T>;
    });
    return [() => memo()[0](), (v => memo()[1](v as any)) as Setter<T | undefined>];
  }
  return [
    () => first as T,
    v => {
      return ((first as any) = typeof v === "function" ? (v as (prev: T) => T)(first as T) : v);
    }
  ] as Signal<T | undefined>;
}

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
  const owner = new Owner();
  let v: Next;
  return () => {
    if (v !== undefined) return v;
    return run(owner, () => (v = compute(value as any)));
  };
}

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
  const owner = new Owner();
  try {
    effect(
      run(owner, () => compute(value as any)),
      value as any
    );
  } catch (err) {
    // TODO: Vet Error Handling
    owner.handleError(err);
  }
}

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
): void {}

export function createAsync<T>(
  compute: (prev?: T) => Promise<T> | AsyncIterable<T> | T,
  value?: T,
  options?: MemoOptions<T>
): Accessor<T> {
  let uninitialized = value === undefined;
  const source = compute(value);
  const isPromise = source instanceof Promise;
  const iterator = (source as AsyncIterable<T>)[Symbol.asyncIterator];
  if (isPromise) {
    source.then(v => (value = v));
  } else if (iterator) {
    iterator()
      .next()
      .then(v => (value = v.value));
  } else return () => source as T;
  return () => {
    if (value === undefined && uninitialized) throw new NotReadyError();
    return value as T;
  };
}

export function isPending() {
  // TODO: Implement isPending
}

export function latest() {
  // TODO: Implement latest
}

export function resolve() {
  // TODO: Implement resolve
}

export function flushSync() {}

export function getObserver() {
  return Observer;
}

export function getOwner() {
  return Owner;
}

export function runWithObserver<T>(o: Computation, fn: () => T): T | undefined {
  const prev = Observer;
  Observer = o;
  try {
    return fn();
  } finally {
    Observer = prev;
  }
}

export function untrack<T>(fn: () => T): T {
  return fn();
}

export function mapArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: Accessor<T>, i: Accessor<number>) => U,
  options: { fallback?: Accessor<any> } = {}
): () => U[] {
  const items = list();
  let s: U[] = [];
  if (items && items.length) {
    for (let i = 0, len = items.length; i < len; i++)
      s.push(
        mapFn(
          () => items[i],
          () => i
        )
      );
  } else if (options.fallback) s = [options.fallback()];
  return () => s;
}

export function repeat<T>(
  count: Accessor<number>,
  mapFn: (i: number) => T,
  options: { fallback?: Accessor<any>; from?: Accessor<number | undefined> } = {}
): () => T[] {
  const len = count();
  const offset = options.from?.() || 0;
  let s: T[] = [];
  if (len) {
    for (let i = 0; i < len; i++) s.push(mapFn(i + offset));
  } else if (options.fallback) s = [options.fallback()];
  return () => s;
}
