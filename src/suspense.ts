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
type SuspenseState = "running" | "suspended" | "fallback";
type SuspenseContextType = {
  increment?: () => void;
  decrement?: () => void;
  state: () => SuspenseState;
  initializing?: boolean;
}
type SuspenseConfig = { timeoutMs: number };
export const SuspenseContext: Context<SuspenseContextType> & {
  transition?: {
    timeoutMs: number;
    register: (p: Promise<any>) => void;
  };
} = createContext<SuspenseContextType>({ state: () => "running" });

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
    return createMemo(() => (Comp = result.value) && sample(() => Comp!(props)));
  }) as T;
}

export interface Resource<T> {
  readonly value: T | undefined;
  readonly error: any;
  readonly loading: boolean;
  readonly failedAttempts: number;
  reload: (delay?: number) => void;
}
// load any async resource
export function loadResource<T>(fn: () => Promise<T> | undefined): Resource<T> {
  const [value, setValue] = createSignal<T | undefined>(),
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
      .then((value: T) => {
        !(ref && ref.cancelled) &&
          freeze(() => {
            failedAttempts = 0;
            pr = undefined;
            setValue(value);
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
        setValue(undefined);
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
    get value() {
      const { increment, decrement } = useContext(SuspenseContext);
      trackPromise();
      if (pr && increment) {
        increment();
        pr.then(() => decrement!());
      }
      return value();
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
