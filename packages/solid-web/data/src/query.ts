/**
 * `query()` — request-deduped async cache for Solid 2, a port of
 * @solidjs/router's `query()` (next branch) with no router dependency.
 *
 * Deduping is by key (`name` + a stable hash of the arguments): calling the
 * wrapped function in a route loader/preload and again in a component memo
 * returns the SAME promise. Solid 2 memos unwrap promises, so
 * `createMemo(() => hello())` suspends into the nearest `<Loading>` boundary —
 * no extra machinery needed.
 *
 * On the server the cache lives per-request in `getRequestEvent().locals`
 * (never module state — an SSR server shares module scope across concurrent
 * requests). On the client it is module-level: an entry is fresh while it is
 * actively observed (a tracking scope read it and hasn't been cleaned up) or
 * within a short window after creation; stale or invalidated entries refetch
 * on the next read.
 *
 * SSR -> hydration usually needs no wiring: the component memo that reads the
 * query is serialized by Solid itself, so the client adopts the server's value
 * without refetching. `collectQueries`/`seedQueries` exist for hosts that warm
 * the cache outside the render tree and need an explicit channel — e.g.
 * TanStack Router, where they wire into its `dehydrate`/`hydrate` options.
 *
 * Deviations from solid-router: server functions are declared GET through
 * transport metadata (compiled references carry no `.GET` property), and
 * routing intent/preload semantics plus Response/redirect handling are not
 * ported (TODO).
 */
import { createSignal, getObserver, onCleanup } from "solid-js";
import { getRequestEvent, isServer } from "@solidjs/web";
// Bare specifier on purpose: the compiled server-function references import
// '@solidjs/web/server-functions', and bundlers give each specifier its own
// module instance — the '/client' subpath would attach metadata in a copy the
// transport never reads.
import { GET, getServerFunctionMetadata, isServerFunction } from "@solidjs/web/server-functions";

const PRELOAD_TIMEOUT = 5000;
const CACHE_TIMEOUT = 180000;
// [ts, promise, value, versionSignal] — solid-router's layout minus the
// intent slot. ts === 0 marks an invalidated entry.
type CacheEntry = [number, any, any, [() => number, (v: number) => void] & { count: number }];
let cacheMap = new Map<string, CacheEntry>();

// cleanup forward/back cache
if (!isServer) {
  setInterval(() => {
    const now = Date.now();
    for (let [k, v] of cacheMap.entries()) {
      if (!v[3].count && now - v[0] > CACHE_TIMEOUT) {
        cacheMap.delete(k);
      }
    }
  }, 300000);
}

function getCache() {
  if (!isServer) return cacheMap;
  const req = getRequestEvent();
  if (!req) throw new Error("Cannot find cache context");
  return ((req.locals.queryCache as Map<string, CacheEntry>) ||
    (req.locals.queryCache = new Map())) as Map<string, CacheEntry>;
}

/**
 * Revalidates the given cache entry/entries (prefix match; omit to
 * revalidate everything).
 */
export function revalidate(key?: string | string[] | void, force = true) {
  force && cacheKeyOp(key, entry => (entry[0] = 0));
  cacheKeyOp(key, entry => entry[3][1](Date.now())); // retrigger live signals
}

export function cacheKeyOp(key: string | string[] | void, fn: (entry: CacheEntry) => void) {
  key && !Array.isArray(key) && (key = [key]);
  const cache = getCache();
  for (let k of cache.keys()) {
    if (key === undefined || matchKey(k, key as string[])) fn(cache.get(k)!);
  }
}

export type CachedFunction<T extends (...args: any) => any> = T & {
  keyFor: (...args: Parameters<T>) => string;
  key: string;
};

function createEntry(ts: number, res: any): CacheEntry {
  const entry: CacheEntry = [ts, res, undefined, createSignal(ts) as any];
  entry[3].count = 0;
  res && typeof res.then === "function"
    ? res.then(
        (v: any) => entry[1] === res && (entry[2] = v),
        () => {}
      )
    : (entry[2] = res);
  return entry;
}

export function query<T extends (...args: any) => any>(fn: T, name: string): CachedFunction<T> {
  // a query is a read: declare server functions GET (keeps them cacheable
  // and off the single-flight path, which only opts in non-GET calls)
  if (isServerFunction(fn) && getServerFunctionMetadata(fn)?.method !== "GET")
    fn = GET(fn) as unknown as T;
  const cachedFn = ((...args: Parameters<T>) => {
    const cache = getCache();
    const now = Date.now();
    const key = name + hashKey(args);
    let cached = cache.get(key);
    let tracking;
    if (getObserver() && !isServer) {
      tracking = true;
      onCleanup(() => cached![3].count--);
    }

    if (cached && cached[0] && (isServer || cached[3].count || now - cached[0] < PRELOAD_TIMEOUT)) {
      if (tracking) {
        cached[3].count++;
        cached[3][0](); // track
      }
      return cached[1];
    }

    const res = fn(...(args as any));
    if (cached) {
      cached[0] = now;
      cached[1] = res;
      res && typeof res.then === "function"
        ? res.then(
            (v: any) => cached![1] === res && (cached![2] = v),
            () => {}
          )
        : (cached[2] = res);
    } else {
      cache.set(key, (cached = createEntry(now, res)));
    }
    if (tracking) {
      cached[3].count++;
      cached[3][0](); // track
    }
    return res;
  }) as unknown as CachedFunction<T>;
  cachedFn.keyFor = (...args: Parameters<T>) => name + hashKey(args);
  cachedFn.key = name;
  return cachedFn;
}

query.get = (key: string) => getCache().get(key)?.[2];

query.set = <T>(key: string, value: T extends Promise<any> ? never : T) => {
  const cache = getCache();
  const now = Date.now();
  let cached = cache.get(key);
  if (cached) {
    cached[0] = now;
    cached[1] = Promise.resolve(value);
    cached[2] = value;
    cached[3][1](now); // notify observers
  } else {
    cache.set(key, (cached = createEntry(now, Promise.resolve(value))));
    cached[2] = value;
  }
};

query.delete = (key: string) => getCache().delete(key);

query.clear = () => getCache().clear();

/**
 * Server-only: snapshot the per-request cache's promises, un-awaited. For
 * hosts that warm the cache outside the render tree and need an explicit
 * SSR -> client channel — e.g. TanStack Router's
 * `dehydrate: () => ({ queries: collectQueries() })`, whose serializer streams
 * promise resolutions. Not needed when queries are only read inside components:
 * Solid serializes the reading memo itself.
 */
export function collectQueries(): Record<string, Promise<any>> {
  const queries: Record<string, Promise<any>> = {};
  if (!isServer) return queries;
  for (const [k, entry] of getCache()) queries[k] = entry[1];
  return queries;
}

/** Client-only counterpart to `collectQueries` — install before hydration renders. */
export function seedQueries(queries?: Record<string, unknown>) {
  if (isServer || !queries) return;
  for (const [key, res] of Object.entries(queries)) {
    if (!cacheMap.has(key)) cacheMap.set(key, createEntry(Date.now(), res));
  }
}

function matchKey(key: string, keys: string[]) {
  for (let k of keys) {
    if (k && key.startsWith(k)) return true;
  }
  return false;
}

// Modified from the amazing TanStack Query library (MIT)
// https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts#L168
export function hashKey<T extends Array<any>>(args: T): string {
  return JSON.stringify(args, (_, val) =>
    isPlainObject(val)
      ? Object.keys(val)
          .sort()
          .reduce((result, key) => {
            result[key] = val[key];
            return result;
          }, {} as any)
      : val
  );
}

function isPlainObject(obj: object) {
  let proto;
  return (
    obj != null &&
    typeof obj === "object" &&
    (!(proto = Object.getPrototypeOf(obj)) || proto === Object.prototype)
  );
}
