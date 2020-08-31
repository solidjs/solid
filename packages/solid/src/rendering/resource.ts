import {
  createContext,
  createEffect,
  useContext,
  untrack,
  batch,
  createMemo,
  createSignal,
  getListener,
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

export function createResource<T>(
  value?: T,
  options: { name?: string; notStreamed?: boolean } = {}
): [Resource<T>, (fn: () => Promise<T> | T) => void] {
  const [s, set] = createSignal<T | undefined>(value),
    [trackPromise, triggerPromise] = createSignal<void>(),
    [trackLoading, triggerLoading] = createSignal<void>(),
    contexts = new Set<SuspenseContextType>(),
    h = globalThis._$HYDRATION;
  let loading = false,
    error: any = null,
    pr: Promise<T> | undefined;

  function loadEnd(v: T | undefined) {
    pr = undefined;
    batch(() => {
      set(v);
      if (h.asyncSSR && options.name) h.resources![options.name] = v;
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
  function load(fn: () => Promise<T> | T) {
    error = null;
    if (fn == null || typeof fn !== "function") return;
    let p: Promise<T> | T;
    const hydrating = h.context && !!h.context.registry;
    if (hydrating) {
      if (h.loadResource && !options.notStreamed) {
        fn = h.loadResource;
      } else if (options.name && h.resources && options.name in h.resources) {
        fn = () => {
          const data = h.resources![options.name!];
          delete h.resources![options.name!];
          return data;
        };
      }
    }
    p = fn();
    if (typeof p !== "object" || !("then" in p)) {
      loadEnd(p);
      return p;
    }
    pr = p;
    if (!loading) {
      loading = true;
      batch(() => {
        triggerLoading();
        triggerPromise();
      });
    }
    return p.then(
      v => (pr === p && loadEnd(v), s()),
      err => (pr === p && ((error = err), loadEnd(undefined)), s())
    );
  }
  Object.defineProperty(read, "loading", {
    get() {
      return trackLoading(), loading;
    }
  });
  return [read as Resource<T>, load];
}

function createResourceNode(v: any, name: string) {
  // maintain setState capability by using normal data node as well
  const node = createSignal(),
    [r, load] = createResource(v, { name });
  return [() => (r(), node[0]()), node[1], load, () => r.loading];
}

export interface LoadStateFunction<T> {
  (
    v: { [P in keyof T]: () => Promise<T[P]> | T[P] },
    reconcilerFn?: (v: Partial<T>) => (state: State<T>) => void
  ): void;
}

export function createResourceState<T extends StateNode>(
  state: T | State<T>,
  options: { name?: string } = {}
): [
  State<T & { loading: { [P in keyof T]: boolean } }>,
  LoadStateFunction<T>,
  SetStateFunction<T>
] {
  const loadingTraps = {
    get(nodes: any, property: string | number) {
      const node =
        nodes[property] ||
        (nodes[property] = createResourceNode(undefined, name && `${options.name}:${property}`));
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
    get(target: StateNode, property: string | number | symbol, receiver: any) {
      if (property === $RAW) return target;
      if (property === $PROXY) return receiver;
      if (property === "loading") return new Proxy(getDataNodes(target), loadingTraps);
      const value = target[property as string | number];
      if (property === $NODE || property === "__proto__") return value;

      const wrappable = isWrappable(value);
      if (getListener() && (typeof value !== "function" || target.hasOwnProperty(property))) {
        let nodes, node;
        if (wrappable && (nodes = getDataNodes(value))) {
          node = nodes._ || (nodes._ = createSignal());
          node[0]();
        }
        nodes = getDataNodes(target);
        node =
          nodes[property] ||
          (nodes[property] = createResourceNode(value, `${options.name}:${property as string}`));
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

  const unwrappedState = unwrap<T>(state || {}, true),
    wrappedState = wrap<T & { loading: { [P in keyof T]: boolean } }>(
      unwrappedState as any,
      resourceTraps
    );
  function setState(...args: any[]): void {
    batch(() => updatePath(unwrappedState, args));
  }
  function loadState(
    v: { [P in keyof T]: () => Promise<T[P]> | T[P] },
    r?: (v: Partial<T>) => (state: State<T>) => void
  ) {
    const nodes = getDataNodes(unwrappedState),
      keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i],
        node =
          nodes[k] || (nodes[k] = createResourceNode(unwrappedState[k], `${options.name}:${k}`)),
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
    const h = globalThis._$HYDRATION,
      hydrating = h.context && h.context.registry,
      ctx = nextHydrateContext(),
      [s, l] = createResource<T>(undefined, { notStreamed: true });
    if (hydrating && h.resources) {
      fn().then(mod => l(() => mod.default));
    } else l(() => fn().then(mod => mod.default));
    let Comp: T | undefined;
    return createMemo(
      () =>
        (Comp = s()) &&
        untrack(() => {
          if (!ctx) return Comp!(props);
          const c = h.context;
          setHydrateContext(ctx);
          const r = Comp!(props);
          !c && setHydrateContext();
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
  const { state } = useContext(SuspenseContext),
    wrapped = createMemo(fn);
  let cached: T;
  return state
    ? createMemo(() => (state() === "suspended" ? cached : (cached = wrapped())))
    : wrapped;
}

type HydrationContext = {
  id: string;
  count: number;
  registry?: Map<string, Element>;
};

type GlobalHydration = {
  context?: HydrationContext;
  register?: (v: Promise<any>) => void;
  loadResource?: () => Promise<any>;
  resources?: { [key: string]: any };
  asyncSSR?: boolean;
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
