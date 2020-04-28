import {
  createContext,
  createEffect,
  useContext,
  sample,
  freeze,
  createMemo,
  createSignal,
  isListening,
  afterEffects,
  Context
} from "./signal";

import {
  updatePath,
  wrap,
  unwrap,
  isWrappable,
  getDataNodes,
  $RAW,
  $NODE,
  $PROXY,
  StateNode,
  SetStateFunction,
  Wrapped,
  setProperty
} from "./state";

import { runtimeConfig, setHydrateContext, nextHydrateContext } from "./shared";

// Suspense Context
type SuspenseState = "running" | "suspended" | "fallback";
type SuspenseContextType = {
  increment?: () => void;
  decrement?: () => void;
  state?: () => SuspenseState;
  initializing?: boolean;
};
type SuspenseConfig = { timeoutMs: number };

function createActivityTracker(): [() => boolean, () => void, () => void] {
  let count = 0;
  const [read, trigger] = createSignal(false);

  return [
    read,
    () => count++ === 0 && trigger(true),
    () => --count <= 0 && trigger(false)
  ];
}

export const SuspenseContext: Context<SuspenseContextType> & {
  transition?: {
    timeoutMs: number;
    increment(): void;
    decrement(): void;
  };
  active?(): boolean;
  increment?(): void;
  decrement?(): void;
} = createContext<SuspenseContextType>({});
const [active, increment, decrement] = createActivityTracker();
SuspenseContext.active = active;
SuspenseContext.increment = increment;
SuspenseContext.decrement = decrement;

export function awaitSuspense(fn: () => any) {
  return new Promise(resolve => {
    const res = fn();
    createEffect(() => !SuspenseContext.active!() && resolve(res));
  });
}

export function createResource<T>(
  value?: T
): [() => T | undefined, (p?: Promise<T>) => () => boolean] {
  const [s, set] = createSignal<T | undefined>(value),
    [trackPromise, triggerPromise] = createSignal<void>(),
    [trackLoading, triggerLoading] = createSignal<void>(),
    contexts = new Set<SuspenseContextType>();
  let loading = false,
    error: any = null,
    pr: Promise<T> | undefined;

  function loadEnd(v: T | undefined) {
    pr = undefined;
    freeze(() => {
      set(v);
      loading && ((loading = false), triggerLoading());
      for (let c of contexts.keys()) c.decrement!();
      contexts.clear();
    });
  }

  function read() {
    const c = useContext(SuspenseContext),
      v = s();
    if (error) throw error;
    trackPromise();
    if (pr && c.increment && !contexts.has(c)) {
      c.increment!();
      contexts.add(c);
    }
    return v;
  }
  function load(p: Promise<T> | T | undefined) {
    error = null;
    if (p == null || typeof p !== "object" || !("then" in p)) {
      pr = undefined;
      loadEnd(p);
    } else {
      pr = p;
      if (!loading) {
        loading = true;
        freeze(() => {
          triggerLoading();
          triggerPromise();
        });
      }
      p.then(
        v => {
          if (pr !== p) return;
          loadEnd(v);
        },
        err => {
          if (pr !== p) return;
          error = err;
          loadEnd(undefined);
        }
      );
    }

    return () => (trackLoading(), loading);
  }
  return [read, load];
}

function createResourceNode(v: any) {
  // maintain setState capability by using normal data node as well
  const node = createSignal(),
    [read, load] = createResource(v);
  return [
    () => (read(), node[0]()),
    node[1],
    load
  ];
}

const resourceTraps = {
  get(target: StateNode, property: string | number | symbol) {
    if (property === $RAW) return target;
    if (property === $PROXY || property === $NODE) return;
    const value = target[property as string | number],
      wrappable = isWrappable(value);
    if (isListening() && (typeof value !== "function" || target.hasOwnProperty(property))) {
      let nodes, node;
      if (wrappable && (nodes = getDataNodes(value))) {
        node = nodes._ || (nodes._ = createSignal());
        node[0]();
      }
      nodes = getDataNodes(target);
      node = nodes[property] || (nodes[property] = createResourceNode(value));
      node[0]();
    }
    return wrappable ? wrap(value) : value;
  },

  set() {
    return true;
  },

  deleteProperty() {
    return true;
  }
};

export interface LoadStateFunction<T> {
  (
    v: { [P in keyof T]?: Promise<T[P]> | T[P] },
    reconcilerFn?: (v: Partial<T>) => (state: Wrapped<T>) => void
  ): { [P in keyof T]: boolean };
};

export function createResourceState<T extends StateNode>(
  state: T | Wrapped<T>
): [Wrapped<T>, LoadStateFunction<T>, SetStateFunction<T>] {
  const unwrappedState = unwrap<T>(state || {}),
    wrappedState = wrap<T>(unwrappedState, resourceTraps),
    loading = {};
  function setState(...args: any[]): void {
    freeze(() => updatePath(unwrappedState, args));
  }
  function loadState(
    v: { [P in keyof T]?: Promise<T[P]> | T[P] },
    r?: (v: Partial<T>) => (state: Wrapped<T>) => void
  ) {
    const nodes = getDataNodes(unwrappedState),
      keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i],
        p = v[k],
        node = nodes[k] || (nodes[k] = createResourceNode(unwrappedState[k])),
        resolver = (v?: T[keyof T]) => (
          r
            ? setState(k, r(v as Partial<T>))
            : setProperty(unwrappedState, k as string | number, v),
          v
        ),
        l = node[2](p && typeof p === "object" && "then" in p ? p.then(resolver) : resolver(p));
      !(k in loading) &&
        Object.defineProperty(loading, k, {
          get() {
            return l();
          }
        });
    }
    return loading;
  }

  return [wrappedState, loadState as LoadStateFunction<T>, setState];
}

interface ComponentType<T> {
  (props: T): any;
}

// lazy load a function component asynchronously
export function lazy<T extends ComponentType<any>>(fn: () => Promise<{ default: T }>): T {
  return ((props: any) => {
    const hydrating = runtimeConfig.hydrate && runtimeConfig.hydrate.registry,
      ctx = nextHydrateContext();
    let s: () => T | undefined, r: (v: T) => void, p;
    if (hydrating) {
      [s, r] = createSignal<T>();
      fn().then(mod => r(mod.default));
    } else {
      [s, p] = createResource<T>();
      p(fn().then(mod => mod.default));
    }
    let Comp: T | undefined;
    return createMemo(
      () =>
        (Comp = s()) &&
        sample(() => {
          if (!ctx) return Comp!(props);
          const h = runtimeConfig.hydrate;
          setHydrateContext(ctx);
          const r = Comp!(props);
          !h && setHydrateContext();
          return r;
        })
    );
  }) as T;
}

export function useTransition(config: SuspenseConfig): [() => boolean, (fn: () => any) => void] {
  const [pending, increment, decrement] = createActivityTracker();
  return [
    pending,
    (fn: () => any) => {
      const prevTransition = SuspenseContext.transition;
      SuspenseContext.transition = {
        timeoutMs: config.timeoutMs,
        increment,
        decrement
      };
      // get around root disposal by starting pending state
      increment();
      fn();
      decrement();
      afterEffects(() => (SuspenseContext.transition = prevTransition));
    }
  ];
}

export function suspend<T>(fn: () => T) {
  const { state } = useContext(SuspenseContext);
  let cached: T;
  return state ? () => (state() === "suspended" ? cached : (cached = fn())) : fn;
}
