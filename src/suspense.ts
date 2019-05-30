import { createSignal, createEffect, createContext, useContext, setContext, sample, onCleanup } from './signals';
import { createState, Wrapped } from './state';

// Suspense Context
type ContextStore = {
  increment: () => void
  decrement: () => void
  suspended: () => Boolean
  initializing: Boolean
}
export const SuspenseContext = createContext(() => {
  let counter = 0;
  const [get, next] = createSignal<void>(),
    store = {
      increment: () => ++counter === 1 && !store.initializing && next(),
      decrement: () => --counter === 0 && next(),
      suspended: () => {
        get();
        return !!counter;
      },
      initializing: true
    }
  return store;
});

// used in the runtime to seed the Suspend control flow
export function registerSuspense(fn: (o: { suspended: () => any, initializing: boolean }) => void) {
  createEffect(() => {
    const c = (SuspenseContext.initFn as Function)();
    setContext(SuspenseContext.id, c);
    fn(c);
    c.initializing = false;
  });
};

// lazy load a function component asyncronously
export function lazy<T extends Function>(fn: () => Promise<{default: T}>) {
  return (props: object) => {
    const result = loadResource(fn().then(mod => mod.default))
    let Comp: T | undefined;
    return () => (Comp = result.data) && sample(() => (Comp as T)(props));
  }
}

// load any async resource
type ResourceState = { loading: Boolean, data?: any, error?: any }
export function loadResource<T>(fn: () => Promise<T>): Wrapped<ResourceState>
export function loadResource<T>(p: Promise<T>):  Wrapped<ResourceState>
export function loadResource<T>(resource: any):  Wrapped<ResourceState> {
  const { increment, decrement } = useContext(SuspenseContext);
  const [state, setState] = createState<ResourceState>({loading: false})

  function doRequest(p: Promise<T>, ref?: {cancelled: Boolean}) {
    setState({ loading: true })
    increment && sample(increment);
    p.then((data: T) => !(ref && ref.cancelled) && setState({ data, loading: false }))
      .catch((error: any) => setState({ error, loading: false }))
      .finally(() => decrement && decrement());
  }

  if (typeof resource === 'function') {
    createEffect(() => {
      let ref = {cancelled: false};
      doRequest(resource(), ref)
      onCleanup(() => ref.cancelled = true)
    });
  } else doRequest(resource);

  return state;
}