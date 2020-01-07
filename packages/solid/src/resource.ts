import {
  createEffect,
  createContext,
  useContext,
  sample,
  onCleanup,
  freeze,
  createMemo,
  createSignal,
  Context
} from "./signal";

import {
  getDataNodes,
  StateNode,
  SetStateFunction,
  Wrapped,
  createState
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
  const [active, setActive] = createSignal(false);
  return [
    active,
    () => count++ === 0 && setActive(true),
    () => --count <= 0 && setActive(false)
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

export function createResource<T>(): [
  () => T | undefined,
  (v: T | undefined) => void
] {
  const [s, set] = createSignal<T | undefined>(),
    contexts = new Set<SuspenseContextType>();
  function cleanContexts() {
    for (let c of contexts.keys()) c.decrement!();
    contexts.clear();
  }
  onCleanup(cleanContexts);
  return [
    () => {
      const c = useContext(SuspenseContext),
        v = s();
      if (v === undefined && c.increment && !contexts.has(c)) {
        c.increment();
        contexts.add(c);
      }
      return v;
    },
    (value: T | undefined) => {
      freeze(() => {
        set(value);
        value !== undefined && cleanContexts();
      });
    }
  ];
}

function createResourceNode() {
  const [current, next] = createResource();
  return {
    current,
    next
  };
}

export function createResourceState<T extends StateNode>(
  keys: (keyof T)[]
): [Wrapped<T>, SetStateFunction<T>] {
  const target = {} as T;
  const nodes = getDataNodes(target);
  for (let i = 0; i < keys.length; i++) nodes[keys[i]] = createResourceNode();
  return createState(target);
}

interface ComponentType<T> {
  (props: T): any;
}

// lazy load a function component asynchronously
export function lazy<T extends ComponentType<any>>(
  fn: () => Promise<{ default: T }>
): T {
  return ((props: any) => {
    const hydrating = runtimeConfig.hydrate && runtimeConfig.hydrate.registry,
      ctx = nextHydrateContext(),
      [s, r] = hydrating ? createSignal<T>() : createResource<T>();
    fn().then(mod => r(mod.default));
    let Comp: T | undefined;
    return createMemo(
      () => (Comp = s()) && sample(() => (setHydrateContext(ctx), Comp!(props)))
    );
  }) as T;
}

// load any async resource
export function load<T>(
  fn: () => Promise<T> | undefined,
  resolve: (v: T | undefined) => void,
  reject?: (e: any, failedAttempts: number) => boolean | void
): [() => boolean, () => void] {
  const [loading, setLoading] = createSignal(false),
    [trackReload, triggerReload] = createSignal<void>();

  let pr: Promise<T> | undefined,
    failedAttempts = 0;

  createEffect(() => {
    let ref = { cancelled: false };
    pr = fn();

    if (!pr || typeof pr.then !== "function") {
      freeze(() => {
        failedAttempts = 0;
        resolve(pr as T | undefined);
        setLoading(false);
      });
      return;
    }

    trackReload();
    setLoading(true);
    pr.then((value: T) => {
      !(ref && ref.cancelled) &&
        freeze(() => {
          failedAttempts = 0;
          resolve(value);
          setLoading(false);
        });
    }).catch((error: any) => {
      !(ref && ref.cancelled) &&
        freeze(() => {
          const loading = (reject && reject(error, ++failedAttempts)) === true;
          !loading && setLoading(loading);
        });
    });
    onCleanup(() => (ref.cancelled = true));
  });

  return [loading, triggerReload as () => void];
}

export function useTransition(
  config: SuspenseConfig
): [() => boolean, (fn: () => any) => void] {
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
  return state
    ? () => (state() === "suspended" ? cached : (cached = fn()))
    : fn;
}
