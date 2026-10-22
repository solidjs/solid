// `from` — a push source (callback subscription, Observable, AsyncIterable)
// as an AsyncIterable a computation can return or `for await` over:
//
//   const value = createMemo(() => from(source));
//
// A subscription keeps the latest value: values that arrive between pulls
// coalesce. An AsyncIterable streams through unchanged. Either way the source
// opens when the result is iterated and closes on return(), on supersede (the
// owning computation re-runs) and on owner disposal, whichever comes first.

import { isThenable, onSupersede } from "./core/async.js";
import { CONFIG_CHILDREN_FORBIDDEN } from "./core/constants.js";
import { cleanup, getOwner } from "./core/owner.js";

/** The observer a `subscribe` call receives. */
type FromObserver<T> = {
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

const DONE: IteratorResult<any> = { value: undefined, done: true };

/**
 * Ties an iterator's `finish` to the computation iterating it. Solid reaches
 * an iterator's return() only when the compute returns the iterable directly.
 * Inside an async generator the generator's own return() is queued behind its
 * pending `await`, and owner cleanups wait for the replacing pass to commit,
 * so close on supersede, with owner disposal as the backstop. No owner (an
 * async compute iterating it after its first `await`, or plain iteration):
 * no registration and no diagnostic, so only return() closes it. Scopes that
 * forbid cleanups rely on supersede and return().
 */
function bindToOwner(finish: () => void): void {
  const owner = getOwner();
  if (!owner) return;
  onSupersede(finish);
  if (!(owner._config & CONFIG_CHILDREN_FORBIDDEN)) cleanup(finish);
}

/**
 * An AsyncIterable as a stream bound to the iterating computation: every
 * value passes through (no coalescing). `finish` calls the inner return()
 * once and settles pending pulls as done, so a `for await` over it exits as
 * soon as the computation re-runs — even when the inner iterator is an async
 * generator whose own return() the language queues behind its pending
 * `await`.
 */
function wrapIterable<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const it = source[Symbol.asyncIterator]();
      let closed = false;
      const pending = new Set<(r: IteratorResult<T>) => void>();
      const finish = (): IteratorResult<T> => {
        if (closed) return DONE;
        closed = true;
        for (const resolve of pending) resolve(DONE);
        pending.clear();
        try {
          const returned = it.return?.();
          if (isThenable(returned)) returned.then(undefined, () => {});
        } catch {}
        return DONE;
      };
      bindToOwner(finish);
      return {
        next(...args: [] | [any]): Promise<IteratorResult<T>> {
          if (closed) return Promise.resolve(DONE);
          const step = it.next(...args);
          // A bare result (the producer's buffered fast path) passes through.
          if (!isThenable(step)) return step as any;
          return new Promise((resolve, reject) => {
            pending.add(resolve);
            step.then(
              r => pending.delete(resolve) && resolve(r),
              e => pending.delete(resolve) && reject(e)
            );
          });
        },
        return(): Promise<IteratorResult<T>> {
          return Promise.resolve(finish());
        }
      };
    }
  };
}

const toCleanup = (t: Teardown): (() => void) =>
  typeof t === "function"
    ? t
    : t && typeof t.unsubscribe === "function"
      ? () => t.unsubscribe()
      : () => {};

/**
 * Converts a callback subscription, an Observable or an AsyncIterable into an
 * AsyncIterable for a Solid computation. A subscription keeps only the latest
 * value, and a value the source emits during `subscribe` is served without a
 * loading frame; an AsyncIterable streams every value through.
 *
 * The source closes on supersede — the owning computation re-running — and
 * on owner disposal. Inside an async generator memo that holds for a
 * `for await` that starts before the first `await`; one that starts after it
 * has no owner to bind to, so its source closes only when the loop ends.
 * Prefer returning `from(...)` from its own memo, with awaited inputs read
 * from upstream memos and transforms done in a downstream memo.
 *
 * Iterate the result with `for await` or return it from a computation: its
 * `next()` returns an already-buffered value as a bare result, not a promise.
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
      return wrapIterable(source as AsyncIterable<T>);
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
        // A throwing unsubscribe must not escape: at supersede this runs
        // inside flush(), ahead of the replacing pass (the returned-iterator
        // path swallows it the same way).
        try {
          c?.();
        } catch {}
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
          w.resolve(DONE);
        }
        return DONE;
      };

      bindToOwner(finish);

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
