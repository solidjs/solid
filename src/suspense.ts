import {
  createSignal,
  createEffect,
  createContext,
  useContext,
  sample,
  onCleanup,
  createMemo
} from "./signal";
import { createState, Wrapped } from "./state";

// Suspense Context
export const SuspenseContext = createContext((maxDuration: number = 0) => {
  let counter = 0,
    t: NodeJS.Timeout,
    state = "running";
  const [get, next] = createSignal<void>(),
    store = {
      increment: () => {
        if (++counter === 1) {
          if (!store.initializing) {
            if (maxDuration) {
              state = "suspended";
              t = setTimeout(() => ((state = "fallback"), next()), maxDuration);
            } else state = "fallback";
            next();
          } else state = "fallback";
        }
      },
      decrement: () => {
        if (--counter === 0) {
          t && clearTimeout(t);
          if (state !== "running") {
            state = "running";
            next();
          }
        }
      },
      state: () => {
        get();
        return state;
      },
      initializing: true
    };
  return store;
});

// lazy load a function component asynchronously
export function lazy<T extends Function>(fn: () => Promise<{ default: T }>) {
  return (props: object) => {
    const result = loadResource(fn().then(mod => mod.default));
    let Comp: T | undefined;
    return createMemo(
      () => (Comp = result.data) && sample(() => (Comp as T)(props))
    );
  };
}

// load any async resource
type ResourceState = { loading: Boolean; data?: any; error?: any };
export function loadResource<T>(fn: () => Promise<T>): Wrapped<ResourceState>;
export function loadResource<T>(p: Promise<T>): Wrapped<ResourceState>;
export function loadResource<T>(resource: any): Wrapped<ResourceState> {
  const { increment, decrement } =
    useContext(SuspenseContext) || ({} as ResourceState);
  const [state, setState] = createState<ResourceState>({ loading: false });

  function doRequest(p: Promise<T>, ref?: { cancelled: Boolean }) {
    setState({ loading: true });
    increment && increment();
    p.then(
      (data: T) => !(ref && ref.cancelled) && setState({ data, loading: false })
    )
      .catch((error: any) => setState({ error, loading: false }))
      .finally(() => decrement && decrement());
  }

  if (typeof resource === "function") {
    createEffect(() => {
      let ref = { cancelled: false },
        res = resource();
      if (!res) return setState({ data: undefined, loading: false });
      doRequest(res, ref);
      onCleanup(() => (ref.cancelled = true));
    });
  } else doRequest(resource);

  return state;
}
