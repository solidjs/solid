import {
  Accessor,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  Setter,
  untrack
} from "./signal.js";

// Note: This will add Symbol.observable globally for all TypeScript users,
// however, we are not polyfilling Symbol.observable. Ensuring the type for
// this global symbol is present is necessary for `observable()` to be
// properly typed for 3rd party library's like RXJS.
declare global {
  interface SymbolConstructor {
    readonly observable: symbol;
  }
}

interface Observable<T> {
  subscribe(observer: ObservableObserver<T>): {
    unsubscribe(): void;
  };
  [Symbol.observable](): Observable<T>;
}

export type ObservableObserver<T> =
  | ((v: T) => void)
  | {
      next?: (v: T) => void;
      error?: (v: any) => void;
      complete?: (v: boolean) => void;
    };
/**
 * creates a simple observable from a signal's accessor to be used with the `from` operator of observable libraries like e.g. rxjs
 * ```typescript
 * import { from } from "rxjs";
 * const [s, set] = createSignal(0);
 * const obsv$ = from(observable(s));
 * obsv$.subscribe((v) => console.log(v));
 * ```
 * description https://www.solidjs.com/docs/latest/api#observable
 */
export function observable<T>(input: Accessor<T>): Observable<T> {
  return {
    subscribe(observer: ObservableObserver<T>) {
      if (!(observer instanceof Object) || observer == null) {
        throw new TypeError("Expected the observer to be an object.");
      }

      const handler =
        typeof observer === "function" ? observer : observer.next && observer.next.bind(observer);

      if (!handler) {
        return { unsubscribe() {} };
      }

      const dispose = createRoot(disposer => {
        createEffect(() => {
          const v = input();
          untrack(() => handler(v));
        });

        return disposer;
      });

      if (getOwner()) onCleanup(dispose);

      return {
        unsubscribe() {
          dispose();
        }
      };
    },
    // Here we're intentionally using `Symbol.observable || "@@observable"` directly
    // without assigning it to an intermediary variable (e.g. we aren't doing
    // `const $$observable = Symbol.observable || "@@observable"`).
    // See for more info: https://github.com/solidjs/solid/pull/1118
    [Symbol.observable || "@@observable"]() {
      return this;
    }
  };
}

export function from<T>(
  producer:
    | ((setter: Setter<T | undefined>) => () => void)
    | { subscribe: (fn: (v: T) => void) => (() => void) | { unsubscribe: () => void } }
): Accessor<T | undefined> {
  const [s, set] = createSignal<T | undefined>(undefined, { equals: false });
  if ("subscribe" in producer) {
    const unsub = producer.subscribe(v => set(() => v));
    onCleanup(() => ("unsubscribe" in unsub ? unsub.unsubscribe() : unsub()));
  } else {
    const clean = producer(set);
    onCleanup(clean);
  }
  return s;
}
