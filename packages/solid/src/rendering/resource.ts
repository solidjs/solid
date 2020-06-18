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
} from "../reactive/signal";

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
  State,
  setProperty
} from "../reactive/state";

import { Component } from "./component";

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

  return [read, () => count++ === 0 && trigger(true), () => --count <= 0 && trigger(false)];
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
  return () =>
    new Promise(resolve => {
      const res = fn();
      createEffect(() => !SuspenseContext.active!() && resolve(res));
    });
}

export interface Resource<T> {
  (): T | undefined;
  loading: boolean;
}

export function createResource<T>(value?: T): [Resource<T>, (p?: Promise<T>) => void] {
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
      return p;
    } else {
      pr = p;
      if (!loading) {
        loading = true;
        freeze(() => {
          triggerLoading();
          triggerPromise();
        });
      }
      return p.then(
        v => (pr === p && loadEnd(v), s()),
        err => (pr === p && ((error = err), loadEnd(undefined)), s())
      );
    }
  }
  Object.defineProperty(read, "loading", {
    get() {
      return trackLoading(), loading;
    }
  });
  return [read as Resource<T>, load];
}

function createResourceNode(v: any) {
  // maintain setState capability by using normal data node as well
  const node = createSignal(),
    [r, load] = createResource(v);
  return [() => (r(), node[0]()), node[1], load, () => r.loading];
}

const loadingTraps = {
  get(nodes: any, property: string | number) {
    const node = nodes[property] || (nodes[property] = createResourceNode(undefined));
    return node[3]();
  },

  set() {
    return true;
  },

  deleteProperty() {
    return true;
  }
};

const resourceTraps = {
  get(target: StateNode, property: string | number | symbol) {
    if (property === $RAW) return target;
    if (property === $PROXY || property === $NODE) return;
    if (property === "loading") return new Proxy(getDataNodes(target), loadingTraps);
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
    reconcilerFn?: (v: Partial<T>) => (state: State<T>) => void
  ): void;
}

export function createResourceState<T extends StateNode>(
  state: T | State<T>
): [
  State<T & { loading: { [P in keyof T]: boolean } }>,
  LoadStateFunction<T>,
  SetStateFunction<T>
] {
  const unwrappedState = unwrap<T>(state || {}),
    wrappedState = wrap<T & { loading: { [P in keyof T]: boolean } }>(
      unwrappedState as any,
      resourceTraps
    );
  function setState(...args: any[]): void {
    freeze(() => updatePath(unwrappedState, args));
  }
  function loadState(
    v: { [P in keyof T]?: Promise<T[P]> | T[P] },
    r?: (v: Partial<T>) => (state: State<T>) => void
  ) {
    const nodes = getDataNodes(unwrappedState),
      keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i],
        node = nodes[k] || (nodes[k] = createResourceNode(unwrappedState[k])),
        resolver = (v?: T[keyof T]) => (
          r
            ? setState(k, r(v as Partial<T>))
            : setProperty(unwrappedState, k as string | number, v),
          v
        ),
        p = node[2](v[k]);
      typeof p === "object" && "then" in p ? p.then(resolver) : resolver(p);
    }
  }

  return [wrappedState, loadState as LoadStateFunction<T>, setState];
}

// lazy load a function component asynchronously
export function lazy<T extends Component<any>>(fn: () => Promise<{ default: T }>): T {
  return ((props: any) => {
    const hydrating = globalThis._$HYDRATION.context && globalThis._$HYDRATION.context.registry,
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
    return () =>
      (Comp = s()) &&
      sample(() => {
        if (!ctx) return Comp!(props);
        const h = globalThis._$HYDRATION.context;
        setHydrateContext(ctx);
        const r = Comp!(props);
        !h && setHydrateContext();
        return r;
      });
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
  return state
    ? ((fn = createMemo(fn)), () => (state() === "suspended" ? cached : (cached = fn())))
    : fn;
}

type HydrationContext = {
  id: string;
  count: number;
  registry?: Map<string, Element>;
};

type GlobalHydration = {
  context?: HydrationContext;
};

declare global {
  var _$HYDRATION: GlobalHydration;
}

function setHydrateContext(context?: HydrationContext): void {
  globalThis._$HYDRATION.context = context;
}

function nextHydrateContext(): HydrationContext | undefined {
  const hydration = globalThis._$HYDRATION;
  return hydration && hydration.context
    ? {
        id: `${hydration.context.id}.${hydration.context.count++}`,
        count: 0,
        registry: hydration.context.registry
      }
    : undefined;
}
