import { flatten, type Accessor, type Setter } from "@solidjs/signals";
import type { JSX } from "../jsx.js";
import type { ChildrenReturn, Context } from "../index.js";
import { onCleanup, createSignal, createMemo, getOwner } from "./signals.js";

export function onMount(fn: () => void) {}

// Context API

export function createContext<T>(defaultValue?: T): Context<T | undefined> {
  const id = Symbol("context");
  const P: Context<T | undefined> = createProvider(id) as any;
  P.id = id;
  P.defaultValue = defaultValue;
  return P as unknown as Context<T | undefined>;
}

export function useContext<T>(context: Context<T>): T {
  const owner = getOwner();
  return owner && owner.context && owner.context[context.id] !== undefined
    ? owner.context[context.id]
    : context.defaultValue;
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

function createProvider(id: symbol) {
  return function provider(props: { value: unknown; children: any }) {
    return createMemo<JSX.Element>(() => {
      const owner = getOwner();
      owner!.context = { ...owner!.context, [id]: props.value };
      return children(() => props.children) as unknown as JSX.Element;
    });
  };
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
