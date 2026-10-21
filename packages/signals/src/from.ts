// `from` — a push source (callback subscription, Observable, AsyncIterable)
// as an AsyncIterable a computation can return or `for await` over:
//
//   const value = createMemo(() => from(source));
//
// Latest-value semantics: values that arrive between pulls coalesce. The
// subscription opens when the iterable is iterated and closes on return(),
// on supersede (the owning computation re-runs) and on owner disposal,
// whichever comes first.

import { onSupersede } from "./core/async.js";
import { CONFIG_CHILDREN_FORBIDDEN } from "./core/constants.js";
import { cleanup, getOwner } from "./core/owner.js";

/** The observer a `subscribe` call receives. */
export type FromObserver<T> = {
  next(value: T): void;
  error(err: unknown): void;
  complete(): void;
};

type Teardown = (() => void) | { unsubscribe(): void } | void;

/**
 * Anything `from` accepts: a subscribe function
 * (`(next, error, complete) => unsubscribe`), an object with
 * `subscribe(observer)` (RxJS and TC39 Observables, including
 * `Symbol.observable` / `"@@observable"` interop), or an AsyncIterable.
 */
export type FromSource<T> =
  | ((next: (value: T) => void, error: (err: unknown) => void, complete: () => void) => Teardown)
  | { subscribe(observer: FromObserver<T>): Teardown }
  | AsyncIterable<T>;

type SubscribeFn<T> = (
  next: (value: T) => void,
  error: (err: unknown) => void,
  complete: () => void
) => Teardown;

function toSubscribe<T>(source: FromSource<T>): SubscribeFn<T> | null {
  if (typeof source === "function") return source;
  // TC39 / RxJS interop: `Symbol.observable` (or "@@observable") returns the observable.
  // Read per call, not at module scope, so the module stays side-effect free.
  const $$observable = (Symbol as any).observable;
  const interop =
    ($$observable && (source as any)?.[$$observable]) ?? (source as any)?.["@@observable"];
  const obs = typeof interop === "function" ? interop.call(source) : source;
  if (obs && typeof obs.subscribe === "function")
    return (next, error, complete) => obs.subscribe({ next, error, complete });
  return null;
}

const toCleanup = (t: Teardown): (() => void) =>
  typeof t === "function"
    ? t
    : t && typeof t.unsubscribe === "function"
      ? () => t.unsubscribe()
      : () => {};

/**
 * Converts a callback subscription, an Observable or an AsyncIterable into an
 * AsyncIterable for a Solid computation. Keeps only the latest value; a value
 * the source emits during `subscribe` is served without a loading frame.
 *
 * The source closes on supersede — the owning computation re-running — even
 * when `from` is iterated with `for await` inside an async generator memo, and
 * on owner disposal. Do transforms in a downstream memo rather than in the
 * loop body.
 *
 * @example
 * ```ts
 * const position = createMemo(() =>
 *   from<Position>((next, error) => {
 *     const id = navigator.geolocation.watchPosition(next, error);
 *     return () => navigator.geolocation.clearWatch(id);
 *   })
 * );
 * const ticks = createMemo(() => from(interval$(rate())));
 * ```
 */
export function from<T>(source: FromSource<T>): AsyncIterable<T> {
  const subscribe = toSubscribe(source);
  if (!subscribe) {
    if (source && typeof (source as any)[Symbol.asyncIterator] === "function")
      return source as AsyncIterable<T>;
    throw new TypeError("from(): expected a subscribe function, an Observable or an AsyncIterable");
  }
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let latest: T | undefined;
      let has = false;
      let done = false;
      let failed = false;
      let failure: unknown;
      let waiting: {
        resolve(r: IteratorResult<T>): void;
        reject(e: unknown): void;
      } | null = null;
      let unsubscribe: (() => void) | null = null;
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        done = true;
        const c = unsubscribe;
        unsubscribe = null;
        c?.();
      };
      const settle = () => {
        if (!waiting) return;
        const w = waiting;
        if (has) {
          waiting = null;
          has = false;
          w.resolve({ value: latest as T, done: false });
        } else if (failed) {
          waiting = null;
          failed = false;
          w.reject(failure);
        } else if (done) {
          waiting = null;
          w.resolve({ value: undefined, done: true });
        }
      };

      const teardown = subscribe(
        value => {
          if (done) return;
          latest = value;
          has = true;
          settle();
        },
        err => {
          if (done) return;
          failed = true;
          failure = err;
          done = true;
          settle();
          close();
        },
        () => {
          if (done) return;
          done = true;
          settle();
          close();
        }
      );
      unsubscribe = toCleanup(teardown);
      // Completed or errored during subscribe: release what it just returned.
      if (closed) {
        const c = unsubscribe;
        unsubscribe = null;
        c();
      }

      // Idempotent: return(), supersede and disposal may all reach it.
      const finish = (): IteratorResult<T> => {
        close();
        has = false;
        if (waiting) {
          const w = waiting;
          waiting = null;
          w.resolve({ value: undefined, done: true });
        }
        return { value: undefined, done: true };
      };

      // Solid reaches return() only when the compute returns this iterable
      // directly. Inside an async generator the generator's own return() is
      // queued behind its pending `await`, and owner cleanups wait for the
      // replacing pass to commit — so close on supersede, with owner disposal
      // as the backstop. Scopes that forbid cleanups rely on return() alone.
      const owner = getOwner();
      if (owner) {
        onSupersede(finish);
        if (!(owner._config & CONFIG_CHILDREN_FORBIDDEN)) cleanup(finish);
      }

      return {
        next(): Promise<IteratorResult<T>> {
          // A buffered value is returned as a bare result, not a promise: the
          // iterator consumer lands it in the same pass, so a source that
          // emits during subscribe (BehaviorSubject-style) shows its value
          // with no loading frame. `for await` accepts either form.
          if (has) {
            has = false;
            return { value: latest as T, done: false } as any;
          }
          if (failed) {
            failed = false;
            return Promise.reject(failure);
          }
          if (done) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve, reject) => {
            waiting = { resolve, reject };
          });
        },
        return(): Promise<IteratorResult<T>> {
          return Promise.resolve(finish());
        }
      };
    }
  };
}
