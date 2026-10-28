/**
 * SPIKE (2026-10-28): record-granularity stores built on core signals.
 *
 * One node per store holds the whole root value as an immutable snapshot
 * (a signal, a writable derived signal for the derive form, or an optimistic
 * signal). Root-key reads go through a per-key memo over that node, so a
 * reader re-runs only when its key's value changes by reference. Values
 * below the root are plain records, served as-is and never tracked.
 *
 * Writes go through a copy-on-write draft: `d.rows[3].title = x` copies the
 * root, `rows`, and row 3 (only the objects on the written path) and
 * publishes the new root. Every frame rule (held writes, lanes, optimistic
 * guesses, pending async) is the core node's, because the store IS one core
 * node.
 */
import { $REFRESH } from "../core/constants.js";
import { createRoot, getObserver, getOwner, runWithOwner, untrack } from "../core/index.js";
import { createMemo, createOptimistic, createSignal } from "../signals.js";
import { installShallowView } from "../store/hooks.js";
import { $PROXY, $TARGET, $TRACK, isWrappable } from "../store/types.js";

const $RAW = Symbol(0 as any);

interface RecordTarget {
  /** The root node: read for a tracked whole-root dependency. */
  r: () => any;
  /** The root node's setter. */
  w: (fn: (prev: any) => any) => any;
  /** Per-key memos, created on first tracked read. */
  m: Map<PropertyKey, () => any>;
  /** The store's own root owner for its key memos. */
  o: (fn: () => any) => any;
  /** The proxy. */
  p: any;
  /** `true`: the record list driver may diff the root array directly. */
  s: true;
  /** The root node itself (refresh / isPending). */
  n: any;
}

const targets = new WeakMap<object, RecordTarget>();

// ---------------------------------------------------------------------------
// copy-on-write drafts

function isOwnAccessor(o: any, k: PropertyKey): boolean {
  const d = Object.getOwnPropertyDescriptor(o, k);
  return !!d && (!!d.get || !!d.set);
}

function unwrapDraft(v: any): any {
  return v !== null && typeof v === "object" && v[$RAW] !== undefined ? v[$RAW] : v;
}

/** A shallow copy that keeps the record's prototype and accessors. */
function copyOf(base: any): any {
  if (Array.isArray(base)) return base.slice();
  const proto = Object.getPrototypeOf(base);
  if (proto === Object.prototype || proto === null) {
    let plain = true;
    for (const k in base) {
      const d = Object.getOwnPropertyDescriptor(base, k);
      if (d && (d.get || d.set)) {
        plain = false;
        break;
      }
    }
    if (plain) return proto === null ? Object.assign(Object.create(null), base) : { ...base };
  }
  const descs = Object.getOwnPropertyDescriptors(base);
  for (const k of Reflect.ownKeys(descs)) {
    const d = (descs as any)[k];
    d.configurable = true;
    if (!d.get && !d.set) d.writable = true;
  }
  return Object.create(proto, descs);
}

function draft(base: any, commit: (copy: any) => void): { p: any; v: () => any } {
  let copy: any = null;
  const kids = new Map<PropertyKey, { p: any; base: any }>();
  const cur = () => copy || base;
  const own = () => {
    if (!copy) commit((copy = copyOf(base)));
    return copy;
  };
  const p = new Proxy(Array.isArray(base) ? [] : {}, {
    get(_, k, receiver) {
      if (k === $RAW) return cur();
      const c = cur();
      const v = c[k];
      if (isWrappable(v) && Object.prototype.hasOwnProperty.call(c, k)) {
        let kid = kids.get(k);
        if (kid === undefined || kid.base !== v) {
          const d = draft(v, n => {
            own()[k] = n;
            kids.set(k, { p: d.p, base: n });
          });
          kids.set(k, (kid = { p: d.p, base: v }));
        }
        return kid.p;
      }
      if (v === undefined && !(k in c)) return Reflect.get(c, k, receiver);
      // Accessors run against the draft, so a getter sees the draft's writes.
      if (!Object.prototype.hasOwnProperty.call(c, k) || !isOwnAccessor(c, k)) return v;
      return Reflect.get(c, k, receiver);
    },
    set(_, k, v) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") return true;
      v = unwrapDraft(v);
      const c = cur();
      if (c[k] !== v || !(k in c)) own()[k] = v;
      return true;
    },
    defineProperty(_, k, d) {
      Object.defineProperty(own(), k, { ...d, configurable: true });
      return true;
    },
    deleteProperty(_, k) {
      if (k in cur()) delete own()[k];
      return true;
    },
    has: (_, k) => k in cur(),
    ownKeys: () => Reflect.ownKeys(cur()),
    getOwnPropertyDescriptor(t: any, k) {
      const c = cur();
      if (k === "length" && Array.isArray(c)) {
        t.length = c.length;
        return Reflect.getOwnPropertyDescriptor(t, k);
      }
      const d = Reflect.getOwnPropertyDescriptor(c, k);
      if (d) d.configurable = true;
      return d;
    },
    getPrototypeOf: () => Object.getPrototypeOf(cur())
  });
  return { p, v: cur };
}

/** Run a draft function over `prev`; the next root (`prev` when unchanged). */
function produce(prev: any, fn: (d: any) => any): any {
  if (prev === null || typeof prev !== "object") return settle(fn(prev), null);
  let next = prev;
  const d = draft(prev, c => (next = c));
  const r = fn(d.p);
  if (r !== undefined && !(r instanceof Promise)) return settle(r, d);
  if (r instanceof Promise) return r.then(v => (v !== undefined ? settle(v, d) : d.v()));
  return next;
}

function settle(r: any, _d: any): any {
  if (r instanceof Promise) return r.then(v => settle(v, _d));
  r = unwrapDraft(r);
  if (Array.isArray(r)) {
    for (let i = 0; i < r.length; i++) {
      const v = r[i];
      if (v !== null && typeof v === "object" && v[$RAW] !== undefined) {
        r = r === _d ? r : r.slice();
        r[i] = v[$RAW];
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// the store proxy

const traps: ProxyHandler<any> = {
  get(target, k) {
    const t = targets.get(target)!;
    if (typeof k === "symbol") {
      if (k === $TARGET) return t;
      if (k === $PROXY) return t.p;
      if (k === $REFRESH) return t.n;
      if (k === $TRACK) {
        if (getObserver() !== null) t.r();
        return undefined;
      }
    }
    if (getObserver() === null) return untrack(t.r)?.[k];
    let m = t.m.get(k);
    if (m === undefined) t.m.set(k, (m = t.o(() => createMemo(() => t.r()?.[k])) as () => any));
    return m!();
  },
  has(target, k) {
    if (k === $TARGET || k === $PROXY || k === $TRACK) return true;
    const t = targets.get(target)!;
    return k in (getObserver() === null ? untrack(t.r) : t.r());
  },
  ownKeys(target) {
    const t = targets.get(target)!;
    return Reflect.ownKeys(getObserver() === null ? untrack(t.r) : t.r());
  },
  getOwnPropertyDescriptor(target, k) {
    const t = targets.get(target)!;
    const v = untrack(t.r);
    if (k === "length" && Array.isArray(v)) {
      target.length = v.length;
      return Reflect.getOwnPropertyDescriptor(target, k);
    }
    const d = Reflect.getOwnPropertyDescriptor(v, k);
    if (d) {
      d.configurable = true;
      d.value = (traps.get as any)(target, k, target);
    }
    return d;
  },
  set() {
    if (__DEV__) console.warn("Cannot mutate a store directly; use its setter.");
    return true;
  },
  deleteProperty() {
    if (__DEV__) console.warn("Cannot mutate a store directly; use its setter.");
    return true;
  }
};

function makeStore(seed: any, node: any, read: () => any, write: (fn: any) => any): any {
  const target: any = Array.isArray(seed) ? [] : {};
  let root: any;
  createRoot(() => (root = getOwner()));
  const owner = (fn: () => any) => runWithOwner(root, fn);
  const t: RecordTarget = {
    r: read,
    w: write,
    m: new Map(),
    o: owner,
    p: new Proxy(target, traps),
    s: true,
    n: node
  };
  targets.set(target, t);
  return t;
}

function setterOf(t: RecordTarget) {
  return (fn: (d: any) => any) => {
    t.w((prev: any) => untrack(() => produce(prev, fn)));
  };
}

// ---------------------------------------------------------------------------
// public surface (same signatures as the deep store's)

export function createStore(first: any, second?: any, third?: any): any {
  if (typeof first === "function") return createDerived(first, second, third, createSignal);
  const [read, write] = createSignal(first, { ownedWrite: true } as any);
  const t = makeStore(first, undefined, read, write as any);
  return [t.p, setterOf(t)];
}

function createDerived(fn: any, seed: any, options: any, factory: any): any {
  const base = seed == null ? {} : seed;
  const compute = (prev: any) => produce(prev === undefined ? base : prev, fn);
  const [read, write] = factory(compute as any, {
    ...options,
    ...(options?.seedLoadingValue ? { loadingValue: base } : null)
  } as any);
  const t = makeStore(base, (read as any)[$REFRESH] ?? read, read, write as any);
  return [t.p, setterOf(t)];
}

export function createProjection(fn: any, seed?: any, options?: any): any {
  return createDerived(fn, seed, options, createSignal)[0];
}

export function createOptimisticStore(first: any, second?: any, third?: any): any {
  if (typeof first === "function") return createDerived(first, second, third, createOptimistic);
  const [read, write] = createOptimistic(first, { ownedWrite: true } as any);
  const t = makeStore(first, undefined, read, write as any);
  return [t.p, setterOf(t)];
}

/** Positional replacement: records are replaced by reference. `key` is the
 * consumer's (`<For keyed>`), not the store's. */
export function reconcile<T extends U, U>(value: T, _key?: any): (state: U) => T {
  return () => value;
}

/** The store's current value: already an immutable snapshot. */
export function snapshot<T>(value: T): T {
  const t: RecordTarget | undefined = (value as any)?.[$TARGET];
  return t?.p === value ? untrack(t.r) : value;
}

/** Tracking snapshot: depends on the whole root. */
export function deep<T>(value: T): T {
  const t: RecordTarget | undefined = (value as any)?.[$TARGET];
  return t?.p === value ? t.r() : value;
}

export { isWrappable };

// The list driver diffs the root array directly (map.ts `shallowView`).
installShallowView((t: any) => (t?.s === true && t.r ? untrack(t.r) : undefined));
