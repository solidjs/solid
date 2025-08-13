import { getOwner, NotReadyError, Owner, runWithOwner } from "@solidjs/signals";

export { createRoot, runWithOwner, onCleanup, getOwner } from "@solidjs/signals";

import type {
  Accessor,
  ComputeFunction,
  EffectFunction,
  EffectOptions,
  MemoOptions,
  Setter,
  Signal,
  SignalOptions
} from "@solidjs/signals";
import { sharedConfig } from "./rendering.js";

class Computation<T> extends Owner {
  _value: T;
  _compute: ComputeFunction<T>;
  _error: unknown;
  constructor(initialValue: T, compute: ComputeFunction<T>) {
    super();
    this._value = initialValue;
    this._compute = compute;
  }
  update() {
    try {
      this._error = undefined;
      runWithOwner(this, () =>
        runWithObserver(this, () => (this._value = this._compute(this._value)))
      );
    } catch (err) {
      this._error = err;
    }
  }
  read() {
    if (this._error) {
      throw this._error;
    }
    return this._value;
  }
}

let Observer: Computation<any> | null = null;

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
  let o = getOwner();
  if (o?.id != null) o?.getNextChildId();
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
  const node = new Computation(value as any, compute);
  let v: Next;
  return () => {
    if (v !== undefined) return v;
    node.update();
    return (v = node.read() as Next);
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
  const node = new Computation(value as any, compute);
  node.update() as any;
  try {
    effect(node.read() as any, value as any);
  } catch (err) {
    // TODO: Vet Error Handling
    // owner.handleError(err);
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
): void {
  let o = getOwner();
  if (o?.id !== null) o?.getNextChildId();
}

export function createAsync<T>(
  compute: (prev?: T) => Promise<T> | AsyncIterable<T> | T,
  value?: T,
  options?: MemoOptions<T> & { deferStream?: boolean }
): Accessor<T> {
  const ctx = sharedConfig.context!;
  const o = new Owner();
  const id = o.id!;
  let uninitialized = value === undefined;
  let source: Promise<T> | AsyncIterable<T> | T;
  function processSource() {
    try {
      source = runWithOwner(o, () => runWithObserver(o as any, () => compute(value))) as any;
    } catch (err) {
      if (err instanceof NotReadyError) {
        (source = err.cause as Promise<any>)!.then(() => processSource()) as any;
      }
      return;
    }

    const iterator = (source as AsyncIterable<T>)[Symbol.asyncIterator];
    if (source instanceof Promise) {
      source.then(v => {
        (source as any).s = "success";
        return ((source as any).value = value = v);
      });
      if (ctx.serialize) ctx.serialize(id, source, options?.deferStream);
      return;
    } else if (iterator) {
      source = iterator()
        .next()
        .then(v => {
          (source as any).s = "success";
          return ((source as any).value = value = v.value);
        });
      if (ctx.serialize) ctx.serialize(id, iterator(), options?.deferStream);
      return;
    }
    return () => source as T;
  }

  return (
    processSource() ||
    (() => {
      if (value === undefined && uninitialized) {
        const error = new NotReadyError();
        error.cause = source;
        throw error;
      }
      return value as T;
    })
  );
}

export function isPending(fn: () => any, fallback?: boolean): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    if (err instanceof NotReadyError && arguments.length > 1) {
      return fallback!;
    }
    throw err;
  }
}

export function latest<T>(fn: () => T, fallback?: T): T | undefined {
  try {
    return fn();
  } catch (err) {
    if (err instanceof NotReadyError && arguments.length > 1) {
      return fallback!;
    }
    throw err;
  }
}

export function resolve() {
  throw new Error("resolve is not implemented on the server");
}

export function flush() {}

export function getObserver() {
  return Observer;
}

export function runWithObserver<T>(o: Computation<any>, fn: () => T): T | undefined {
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
  const root = getOwner()!;
  const id = root.getNextChildId();
  return () => {
    const items = list();
    let s: U[] = [];
    if (items && items.length) {
      for (let i = 0, len = items.length; i < len; i++) {
        const o = new Owner(id + i, true);
        root.append(o);
        s.push(
          runWithOwner(o, () =>
            mapFn(
              () => items[i],
              () => i
            )
          )
        );
      }
    } else if (options.fallback) s = [options.fallback()];
    return s;
  };
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
