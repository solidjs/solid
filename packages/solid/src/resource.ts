import {
  createContext,
  useContext,
  sample,
  freeze,
  createMemo,
  createSignal,
  isListening,
  Context,
  DataNode
} from "./signal";

import {
  updatePath,
  wrap,
  unwrap,
  isWrappable,
  getDataNodes,
  SNODE,
  SPROXY,
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
  let count = 0,
    active = false;
  const [read, trigger] = createSignal<void>();
  return [
    () => (read(), active),
    () => count++ === 0 && ((active = true), trigger()),
    () => --count <= 0 && ((active = false), trigger())
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

function generatePlaceholderPromise<T>(isCancelled: (p: Promise<T>) => boolean) {
  let p: Promise<T>;
  return (p = new Promise<T>((res, rej) =>
    setTimeout(
      () => (
        !isCancelled(p) && console.warn("Load not started for read resource by next task"), rej()
      )
    )
  ));
}

export function createResource<T>(
  value?: T
): [() => T | undefined, (p?: Promise<T>) => () => boolean] {
  const [s, set] = createSignal<T | undefined>(value),
    [trackPromise, triggerPromise] = createSignal<void>(),
    [trackLoading, triggerLoading] = createSignal<void>(),
    contexts = new Set<SuspenseContextType>();
  let loading = value === undefined,
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
    if (loading && !pr) {
      load(generatePlaceholderPromise((p: Promise<T>) => p === pr));
    }
    trackPromise();
    if (pr && c.increment && !contexts.has(c)) {
      c.increment();
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
        })
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
  const node = new DataNode(),
    [read, load] = createResource(v);
  return {
    current: () => (read(), node.current()),
    next: node.next.bind(node),
    load
  };
}

const resourceTraps = {
  get(target: StateNode, property: string | number | symbol) {
    if (property === "_state") return target;
    if (property === SPROXY || property === SNODE) return;
    const value = target[property as string | number],
      wrappable = isWrappable(value);
    if (isListening() && (typeof value !== "function" || target.hasOwnProperty(property))) {
      let nodes, node;
      if (wrappable && (nodes = getDataNodes(value))) {
        node = nodes._ || (nodes._ = new DataNode());
        node.current();
      }
      nodes = getDataNodes(target);
      node = nodes[property] || (nodes[property] = createResourceNode(value));
      node.current();
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

type LoadStateFunction<T> = {
  (
    v: { [P in keyof T]: Promise<T[P]> | T[P] },
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
    v: { [P in keyof T]: Promise<T[P]> | T[P] },
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
            ? setState(r({ [k]: v } as Partial<T>))
            : setProperty(unwrappedState, k as string | number, v),
          v
        ),
        l = node.load(p && typeof p === "object" && "then" in p ? p.then(resolver) : resolver(p));
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
    return createMemo(() => (Comp = s()) && sample(() => (setHydrateContext(ctx), Comp!(props))));
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
      SuspenseContext.transition = prevTransition;
    }
  ];
}

export function awaitSuspense<T>(fn: () => T) {
  const { state } = useContext(SuspenseContext);
  let cached: T;
  return state ? () => (state() === "suspended" ? cached : (cached = fn())) : fn;
}
