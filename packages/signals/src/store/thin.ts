/**
 * SPIKE (not for merge): a signal-per-touched-key deep store.
 *
 * The raw object is the seed and the identity; it is never mutated. Every key
 * that is tracked or written gets one core signal, and that signal is the
 * key's whole state: committed value, staging, holds and lanes are core's.
 * There is no pending backing, no fold, no commit hook.
 */
import { NOT_PENDING } from "../core/constants.js";
import { read, setSignal, signal, tracking, untrack } from "../core/core.js";
import { getObserver } from "../core/owner.js";
import type { Signal } from "../core/types.js";
import { $PROXY, $TRACK, isRawValue, isWrappable } from "./types.js";

export const $THIN = Symbol(__DEV__ ? "THIN_TARGET" : 0);
const ABSENT: any = Symbol(__DEV__ ? "ABSENT" : 0);

interface Target {
  /** seed + identity */
  v: any;
  /** value nodes */
  n: Record<PropertyKey, Signal<any>> | null;
  /** presence nodes */
  h: Record<PropertyKey, Signal<boolean>> | null;
  /** structure version */
  k: Signal<number> | null;
  /** proxy */
  p: any;
  /** array? */
  r: boolean;
}

const targets = new WeakMap<object, Target>();
const hasOwn = Object.prototype.hasOwnProperty;
const lookupGetter = (Object.prototype as any).__lookupGetter__;
const nodeOpts = { ownedWrite: true };
let writing = 0;

function wrap(v: any): any {
  let t = targets.get(v);
  if (t === undefined) {
    const r = Array.isArray(v);
    t = { v, n: null, h: null, k: null, p: null, r };
    t.p = new Proxy(r ? [] : {}, traps(t));
    targets.set(v, t);
  }
  return t.p;
}
const serve = (v: any) => (isWrappable(v) && !isRawValue(v) ? wrap(v) : v);
export const unwrapThin = (v: any): any => v?.[$THIN]?.v ?? v;

/** The reader's frame of a node: the draft reads its own staging; everyone
 * else reads through core (tracked or not: a pass joins a hold either way). */
function peek(node: Signal<any>): any {
  if (writing) return node._pendingValue !== NOT_PENDING ? node._pendingValue : node._value;
  return tracking ? untrack(() => read(node)) : read(node);
}
function seed(t: Target, key: PropertyKey): any {
  return hasOwn.call(t.v, key) ? t.v[key] : ABSENT;
}
function nodeOf(t: Target, key: PropertyKey): Signal<any> {
  const n = (t.n ??= Object.create(null) as Record<PropertyKey, Signal<any>>);
  return (n[key] ??= signal(seed(t, key), nodeOpts));
}
/** The logical value of `key` in the reader's frame (ABSENT when not own). */
function valueOf(t: Target, key: PropertyKey): any {
  const node = t.n?.[key];
  return node !== undefined ? peek(node) : seed(t, key);
}
function keysOf(t: Target): (string | symbol)[] {
  const n = t.n;
  if (t.r) {
    const len = valueOf(t, "length");
    const keys: string[] = [];
    for (let i = 0; i < len; i++) if (valueOf(t, i) !== ABSENT) keys.push("" + i);
    keys.push("length");
    return keys;
  }
  const keys = Reflect.ownKeys(t.v);
  if (n === null) return keys;
  const out = keys.filter(key => n[key] === undefined || peek(n[key]) !== ABSENT);
  for (const key of Reflect.ownKeys(n))
    if (!hasOwn.call(t.v, key) && peek(n[key]) !== ABSENT) out.push(key);
  return out;
}
function track(t: Target): void {
  if (!writing && getObserver() !== null) read((t.k ??= signal(0, nodeOpts)));
}
function write(t: Target, key: PropertyKey, v: any): void {
  if (t.n?.[key] === undefined && seed(t, key) === v) return;
  const node = nodeOf(t, key);
  const prev = peek(node);
  if (prev === v) return;
  setSignal(node, () => v);
  const h = t.h?.[key];
  if (h !== undefined) setSignal(h, v !== ABSENT);
  // Structure: membership for records; position is content for arrays.
  if (t.k !== null && (t.r ? key !== "length" : prev === ABSENT || v === ABSENT))
    setSignal(t.k, (x: number) => x + 1);
}

function traps(t: Target): ProxyHandler<any> {
  return {
    get(_, key, receiver) {
      if (key === $THIN) return t;
      if (key === $PROXY) return receiver;
      if (key === $TRACK) return (track(t), undefined);
      let node = t.n?.[key];
      const tracked = !writing && getObserver() !== null;
      if (node === undefined) {
        const own = hasOwn.call(t.v, key);
        // Accessors and prototype members run against the proxy.
        if (own ? lookupGetter.call(t.v, key) !== undefined : key in t.v) {
          const v = Reflect.get(t.v, key, receiver);
          return typeof v === "function" ? v : serve(v);
        }
        if (!tracked) return own ? serve(t.v[key]) : undefined;
        node = nodeOf(t, key);
      }
      const v = tracked ? read(node) : peek(node);
      return v === ABSENT ? undefined : serve(v);
    },
    has(_, key) {
      if (key === $THIN || key === $PROXY || key === $TRACK) return true;
      if (!writing && getObserver() !== null) {
        const h = (t.h ??= Object.create(null) as Record<PropertyKey, Signal<boolean>>);
        return read((h[key] ??= signal(valueOf(t, key) !== ABSENT, nodeOpts)));
      }
      const v = valueOf(t, key);
      return v !== ABSENT || (!hasOwn.call(t.v, key) && key in t.v);
    },
    ownKeys() {
      track(t);
      return keysOf(t);
    },
    getOwnPropertyDescriptor(_, key) {
      if (t.r && key === "length")
        return { value: valueOf(t, key), writable: true, enumerable: false, configurable: false };
      const v = this.has!(_, key) ? valueOf(t, key) : ABSENT;
      if (v === ABSENT) return undefined;
      const d = Object.getOwnPropertyDescriptor(t.v, key);
      if (d && (d.get || d.set)) return ((d.configurable = true), d);
      return {
        value: serve(v),
        writable: true,
        enumerable: d ? d.enumerable : true,
        configurable: true
      };
    },
    set(_, key, value) {
      if (!writing || key === "__proto__") return true;
      const v = unwrapThin(value);
      if (t.r) {
        const len = valueOf(t, "length");
        if (key === "length") {
          for (let i = v; i < len; i++) write(t, i, ABSENT);
        } else if (typeof key === "string" && +key >= len) write(t, "length", +key + 1);
      }
      write(t, key, v);
      return true;
    },
    deleteProperty(_, key) {
      if (writing) write(t, key, ABSENT);
      return true;
    },
    getPrototypeOf: () => Object.getPrototypeOf(t.v)
  };
}

function replace(t: Target, next: any): void {
  if (next === t.v) return;
  for (const key of keysOf(t)) if (!hasOwn.call(next, key)) write(t, key, ABSENT);
  for (const key of Reflect.ownKeys(next)) write(t, key, unwrapThin(next[key]));
}

export function thinSetter<T>(proxy: T, fn: (draft: T) => T | void): void {
  writing++;
  let result: any;
  try {
    result = fn(proxy);
  } finally {
    writing--;
  }
  if (result !== undefined && result !== proxy && isWrappable(result)) {
    writing++;
    try {
      replace((proxy as any)[$THIN], unwrapThin(result));
    } finally {
      writing--;
    }
  }
}

export function createThinStore<T extends object>(
  value: T
): [T, (fn: (draft: T) => T | void) => void] {
  const proxy = wrap(unwrapThin(value));
  return [proxy, fn => thinSetter(proxy, fn)];
}

/** Keyed merge of `next` into the store (inside a setter). */
export function thinReconcile(proxy: any, next: any, keyFn: ((v: any) => any) | null): void {
  const t: Target = proxy[$THIN];
  next = unwrapThin(next);
  if (next === t.v) return;
  const merge = (pv: any, nv: any): any => {
    nv = unwrapThin(nv);
    if (
      pv === nv ||
      !isWrappable(pv) ||
      !isWrappable(nv) ||
      Array.isArray(pv) !== Array.isArray(nv)
    )
      return nv;
    if (keyFn !== null) {
      const pk = keyFn(wrap(pv));
      if (pk !== undefined && pk !== keyFn(nv)) return nv;
    }
    thinReconcile(wrap(pv), nv, keyFn);
    return pv;
  };
  if (t.r) {
    const len = valueOf(t, "length");
    let byKey: Map<any, any> | null = null;
    for (let i = 0; i < next.length; i++) {
      const nv = next[i];
      let pv = i < len ? valueOf(t, i) : undefined;
      const nk = keyFn !== null && isWrappable(nv) ? keyFn(nv) : undefined;
      if (nk !== undefined && !(isWrappable(pv) && keyFn!(wrap(pv)) === nk)) {
        if (byKey === null) {
          byKey = new Map();
          for (let j = 0; j < len; j++) {
            const p = valueOf(t, j);
            const k = isWrappable(p) ? keyFn!(wrap(p)) : undefined;
            if (k !== undefined && !byKey.has(k)) byKey.set(k, p);
          }
        }
        pv = byKey.get(nk);
      }
      write(t, i, merge(pv, nv));
    }
    for (let i = next.length; i < len; i++) write(t, i, ABSENT);
    write(t, "length", next.length);
    return;
  }
  for (const key of keysOf(t)) if (!hasOwn.call(next, key)) write(t, key, ABSENT);
  for (const key of Reflect.ownKeys(next)) {
    const pv = valueOf(t, key);
    write(t, key, merge(pv === ABSENT ? undefined : pv, next[key]));
  }
}

/** Plain copy of the reader's frame; untouched subtrees keep source identity. */
export function thinSnapshot(value: any, seen = new Map<object, any>()): any {
  const raw = unwrapThin(value);
  if (!isWrappable(raw)) return raw;
  const t = targets.get(raw);
  if (t === undefined) return raw;
  if (seen.has(raw)) return seen.get(raw);
  seen.set(raw, raw);
  let copy: any = null;
  const keys = keysOf(t);
  const start = () => {
    if (copy === null) {
      copy = t.r ? [] : Object.create(Object.getPrototypeOf(raw));
      seen.set(raw, copy);
      for (const k of keys) if (k !== "length" || !t.r) copy[k] = valueOf(t, k);
    }
  };
  if (t.n !== null) start();
  for (const k of keys) {
    if (t.r && k === "length") continue;
    const v = copy !== null ? copy[k] : raw[k];
    const s = thinSnapshot(v, seen);
    if (s !== v) (start(), (copy[k] = s));
  }
  return copy ?? raw;
}
