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
export let Owner: Owner | null = null;
let Observer: Computation | null = null;

interface Owner {
  owner: Owner | null;
  context: any | null;
  owned: Owner[] | null;
  cleanups: (() => void)[] | null;
}

export function createRoot<T>(fn: ((dispose: () => void) => T) | (() => T)): T {
  const owner = Owner,
    root = {
      context: owner ? owner.context : null,
      owner: owner,
      owned: null,
      cleanups: null
    };
  Owner = root;
  try {
    return fn(fn.length === 0 ? () => {} : () => cleanNode(root));
  } finally {
    Owner = owner;
  }
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
  Owner = createOwner();
  let v: Next;
  try {
    v = compute(value as Init);
  } finally {
    Owner = Owner.owner;
  }
  return () => v;
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
  Owner = createOwner();
  try {
    effect(compute(value as any), value as any);
  } catch (err) {
    // TODO: Implement error handling
    // handleError(err);
  } finally {
    Owner = Owner.owner;
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

export function createAsync() {
  // TODO: Implement createAsync
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

export function runWithOwner<T>(o: typeof Owner, fn: () => T): T | undefined {
  const prev = Owner;
  Owner = o;
  try {
    return fn();
  } finally {
    Owner = prev;
  }
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

export function onCleanup(fn: () => void) {
  if (Owner) {
    if (!Owner.cleanups) Owner.cleanups = [fn];
    else Owner.cleanups.push(fn);
  }
  return fn;
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

// TODO: Update Internals to reflect new Signals implementation Internals
function createOwner(): Owner {
  const o = { owner: Owner, context: Owner ? Owner.context : null, owned: null, cleanups: null };
  if (Owner) {
    if (!Owner.owned) Owner.owned = [o];
    else Owner.owned.push(o);
  }
  return o;
}

function cleanNode(node: Owner) {
  if (node.owned) {
    for (let i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (let i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
    node.cleanups = null;
  }
}
