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

// Suspense Context
type SuspenseConfig = { timeoutMs: number };
export const SuspenseContext: Context & {
  transition?: {
    timeoutMs: number;
    register: (p: Promise<any>) => void;
  };
} = createContext({ state: () => "running" });

interface ComponentType<T> {
  (props: T): any;
}

// lazy load a function component asynchronously
export function lazy<T extends ComponentType<any>>(
  fn: () => Promise<{ default: T }>
): T {
  return ((props: any) => {
    const result = loadResource<T>(() => fn().then(mod => mod.default));
    let Comp: T | undefined;
    return createMemo(() => (Comp = result.data) && sample(() => Comp!(props)));
  }) as T;
}

export interface Resource<T> {
  readonly data: T | undefined;
  readonly error: any;
  readonly loading: boolean;
  readonly failedAttempts: number;
  reload: (delay?: number) => void;
}
// load any async resource
export function loadResource<T>(fn: () => Promise<T> | undefined): Resource<T> {
  const [data, setData] = createSignal<T | undefined>(),
    [error, setError] = createSignal<any>(),
    [loading, setLoading] = createSignal(false),
    [trackPromise, triggerPromise] = createSignal(),
    [trackReload, triggerReload] = createSignal();

  let pr: Promise<T> | undefined,
    failedAttempts = 0,
    delay: number | undefined = 0;

  function doRequest(ref?: { cancelled: Boolean }) {
    if (ref && ref.cancelled) return;
    pr!
      .then((data: T) => {
        !(ref && ref.cancelled) &&
          freeze(() => {
            failedAttempts = 0;
            pr = undefined;
            setData(data);
            setLoading(false);
          });
      })
      .catch((error: any) => {
        !(ref && ref.cancelled) &&
          freeze(() => {
            failedAttempts++;
            pr = undefined;
            setError(error);
            setLoading(false);
          });
      });
    SuspenseContext.transition && SuspenseContext.transition.register(pr!);
  }

  createEffect(() => {
    let ref = { cancelled: false };
    pr = fn();

    if (!pr) {
      freeze(() => {
        failedAttempts = 0;
        setData(undefined);
        setLoading(false);
      });
      return;
    }

    trackReload();
    setLoading(true);
    triggerPromise(undefined);
    if (delay) {
      setTimeout(() => doRequest(ref), delay);
      delay = undefined;
    } else doRequest(ref);
    onCleanup(() => (ref.cancelled = true));
  });

  return {
    get data() {
      const { increment, decrement } = useContext(SuspenseContext);
      trackPromise();
      if (pr && increment) {
        increment();
        pr.then(() => decrement());
      }
      return data();
    },
    get error() {
      return error();
    },
    get loading() {
      return loading();
    },
    get failedAttempts() {
      return failedAttempts;
    },
    reload: ms => {
      delay = ms;
      triggerReload(undefined);
    }
  };
}

export function useTransition(
  config: SuspenseConfig
): [(fn: () => any) => void, () => boolean] {
  const [pending, setPending] = createSignal(false);
  return [
    (fn: () => any) => {
      let count = 0;
      const prevTransition = SuspenseContext.transition;
      SuspenseContext.transition = {
        timeoutMs: config.timeoutMs,
        register(p) {
          if (count++ === 0) setPending(true);
          p.finally(() => --count <= 0 && setPending(false));
        }
      };
      fn();
      SuspenseContext.transition = prevTransition;
    },
    pending
  ];
}
