import { createSignal, createEffect, createContext, useContext, setContext, sample } from './signals';

// Suspense Context
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
    const c = SuspenseContext.initFn();
    setContext(SuspenseContext.id, c);
    fn(c);
    c.initializing = false;
  });
};

// lazy load a function component asyncronously
export function lazy<T extends Function>(fn: () => Promise<{default: T}>) {
  return (props: object) => {
    const getComp = loadResource(fn().then(mod => mod.default))
    let Comp: T | undefined;
    return () => (Comp = getComp()) && sample(() => (Comp as T)(props));
  }
}

// load any async resource and return an accessor
export function loadResource<T>(p: Promise<T>) {
  const { increment, decrement } = useContext(SuspenseContext) || { increment: undefined, decrement: undefined};
  const [results, setResults] = createSignal<T | undefined>(),
    [error, setError] = createSignal<any>();
  increment && increment();
  p.then(data => setResults(data))
    .catch(err => setError(err))
    .finally(() => decrement && decrement());
  (results as (() => T | undefined) & {error: () => any}).error = error;
  return results;
}