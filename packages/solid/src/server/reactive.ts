import {
  flatten,
  getContext,
  Owner,
  runWithOwner,
  setContext,
  type Accessor,
  type Setter
} from "@solidjs/signals";
import type { JSX } from "../jsx.js";
import type { ChildrenReturn, Context, EffectOptions, FlowProps } from "../index.js";
import { onCleanup, createSignal, createMemo, createRoot, createEffect } from "./signals.js";

export function onMount(fn: () => void) {
  (createEffect as any)();
}

// Context API

export function createContext<T>(
  defaultValue?: T,
  options?: EffectOptions
): Context<T | undefined> {
  const id = Symbol((options && options.name) || "");
  function provider(props: FlowProps<{ value: unknown }>) {
    return createRoot(() => {
      setContext(provider, props.value);
      return children(() => props.children);
    });
  }
  provider.id = id;
  provider.defaultValue = defaultValue;
  return provider as unknown as Context<T | undefined>;
}

export function useContext<T>(context: Context<T>): T {
  return getContext(context);
}

export function children(fn: Accessor<JSX.Element>): ChildrenReturn {
  const children = createMemo(fn);
  const memo = createMemo(() => flatten(children()));
  (memo as ChildrenReturn).toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo as ChildrenReturn;
}

export type ObservableObserver<T> =
  | ((v: T) => void)
  | {
      next: (v: T) => void;
      error?: (v: any) => void;
      complete?: (v: boolean) => void;
    };
export function observable<T>(input: Accessor<T>) {
  return {
    subscribe(observer: ObservableObserver<T>) {
      return {
        unsubscribe() {}
      };
    },
    [Symbol.observable || "@@observable"]() {
      return this;
    }
  };
}

export function from<T>(
  producer:
    | ((setter: Setter<T>) => () => void)
    | {
        subscribe: (fn: (v: T) => void) => (() => void) | { unsubscribe: () => void };
      }
): Accessor<T> {
  const [s, set] = createSignal<T | undefined>(undefined, { equals: false }) as [
    Accessor<T>,
    Setter<T>
  ];
  if ("subscribe" in producer) {
    const unsub = producer.subscribe(v => set(() => v));
    onCleanup(() => ("unsubscribe" in unsub ? unsub.unsubscribe() : unsub()));
  } else {
    const clean = producer(set);
    onCleanup(clean);
  }
  return s;
}

export function ssrRunInScope(fn: () => any): () => any;
export function ssrRunInScope(array: (() => any)[]): (() => any)[];
export function ssrRunInScope(fn: (() => any) | (() => any)[]): (() => any) | (() => any)[] {
  if (Array.isArray(fn)) {
    const o = new Owner();
    return fn.map<() => any>(f => runWithOwner.bind(null, o, f));
  }
  return runWithOwner.bind(null, new Owner(), fn);
}
