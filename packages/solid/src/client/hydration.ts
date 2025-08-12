import {
  getOwner,
  createAsync as coreAsync,
  MemoOptions,
  Accessor,
  createSuspense,
  createSignal,
  flushSync,
  createMemo,
  runWithObserver,
  Computation
} from "@solidjs/signals";
import { JSX } from "../jsx.js";

export type HydrationContext = {};

type SharedConfig = {
  hydrating: boolean;
  resources?: { [key: string]: any };
  load?: (id: string) => Promise<any> | any;
  has?: (id: string) => boolean;
  gather?: (key: string) => void;
  registry?: Map<string, Element>;
  done: boolean;
  getNextContextId(): string;
};

export const sharedConfig: SharedConfig = {
  hydrating: false,
  registry: undefined,
  // effects: undefined,
  done: false,
  getNextContextId() {
    const o = getOwner();
    if (!o) throw new Error(`getNextContextId cannot be used under non-hydrating context`);
    return o.getNextChildId();
  }
};

/**
 * Tracks all resources inside a component and renders a fallback until they are all resolved
 * ```typescript
 * const AsyncComponent = lazy(() => import('./component'));
 *
 * <Suspense fallback={<LoadingIndicator />}>
 *   <AsyncComponent />
 * </Suspense>
 * ```
 * @description https://docs.solidjs.com/reference/components/suspense
 */
export function Suspense(props: { fallback?: JSX.Element; children: JSX.Element }): JSX.Element {
  if (!sharedConfig.hydrating)
    return createSuspense(
      () => props.children,
      () => props.fallback
    ) as unknown as JSX.Element;

  return createMemo(() => {
    const o = getOwner()!;
    const id = o.id!;
    if (sharedConfig.hydrating && sharedConfig.has!(id)) {
      let ref = sharedConfig.load!(id);
      let p: Promise<any> | any;
      if (ref) {
        if (typeof ref !== "object" || ref.s !== "success") p = ref;
        else sharedConfig.gather!(id);
      }
      if (p) {
        const [s, set] = createSignal(undefined, { equals: false });
        s();
        if (p !== "$$f") {
          p.then(
            () => {
              sharedConfig.gather!(id);
              sharedConfig.hydrating = true;
              set();
              flushSync();
              sharedConfig.hydrating = false;
            },
            (err: any) =>
              runWithObserver(o as Computation<any>, () => {
                throw err;
              })
          );
        } else queueMicrotask(set);
        return props.fallback;
      }
    }
    return createSuspense(
      () => props.children,
      () => props.fallback
    );
  }) as unknown as JSX.Element;
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
  if (!sharedConfig.hydrating) return coreAsync(compute, value, options);
  return coreAsync(
    (prev?: T | undefined) => {
      if (!sharedConfig.hydrating) return compute(prev);
      const o = getOwner()!;
      let initP: any;
      if (sharedConfig.has!(o.id!)) initP = sharedConfig.load!(o.id!);
      const init = initP?.value || initP;
      return init ? (subFetch<T>(compute, prev), init) : compute(prev);
    },
    value,
    options
  );
}

// mock promise while hydrating to prevent fetching
class MockPromise {
  static all() {
    return new MockPromise();
  }
  static allSettled() {
    return new MockPromise();
  }
  static any() {
    return new MockPromise();
  }
  static race() {
    return new MockPromise();
  }
  static reject() {
    return new MockPromise();
  }
  static resolve() {
    return new MockPromise();
  }
  catch() {
    return new MockPromise();
  }
  then() {
    return new MockPromise();
  }
  finally() {
    return new MockPromise();
  }
}

function subFetch<T>(fn: (prev?: T) => T | Promise<T> | AsyncIterable<T>, prev?: T) {
  const ogFetch = fetch;
  const ogPromise = Promise;
  try {
    window.fetch = () => new MockPromise() as any;
    Promise = MockPromise as any;
    return fn(prev);
  } finally {
    window.fetch = ogFetch;
    Promise = ogPromise;
  }
}
