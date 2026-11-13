/**
 * SPIKE (not for merge): a signal-per-touched-key deep store.
 *
 * The raw object is the seed and the identity; it is never mutated. Every key
 * that is tracked or written gets one core signal, and that signal is the
 * key's whole state: committed value, staging, holds and lanes are core's.
 * There is no pending backing, no fold, no commit hook.
 */
import {
  $REFRESH,
  CONFIG_HELD,
  CONFIG_OVERRIDE,
  CONFIG_STAGED_ERROR,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  NOT_PENDING,
  STATUS_ERROR,
  STATUS_PENDING
} from "../core/constants.js";
import { context, pullComputed, read, setSignal, signal, tracking, untrack } from "../core/core.js";
import { link } from "../core/graph.js";
import { getObserver } from "../core/owner.js";
import {
  flushTransaction,
  holdNode,
  laneStageHook,
  list,
  observeFlightHook,
  passLane,
  txOf
} from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import type { StoreFamily } from "./target.js";
import { $PROXY, $TRACK, isRawValue, isWrappable, writeOverride } from "./types.js";

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
  /** derived-store family (projection), or null */
  _fam: StoreFamily | null;
  /** the family code reads these names */
  dk: null;
  s: boolean;
}

const targets = new WeakMap<object, Target>();
const hasOwn = Object.prototype.hasOwnProperty;
const lookupGetter = (Object.prototype as any).__lookupGetter__;
const nodeOpts = { ownedWrite: true };
let writing = 0;
/** Optimistic families' guess hooks (thinOptimistic.ts installs them), so a
 * bundle without optimistic stores carries no guess engine. */
let guess: ((n: Signal<any>, v: any) => void) | null = null;
let guessed: ((n: Signal<any>) => any) | null = null;
export function installThinGuesses(w: typeof guess, g: typeof guessed): void {
  guess = w;
  guessed = g;
}
/** The open setter is a user's (not the derive's draft or landing). */
let userWrite = false;
/** A derive's first, synchronous pass: its writes are the seed. */
let directCommit = false;

export function thinWrap(v: any, fam: StoreFamily | null = null): any {
  const map: WeakMap<object, any> = fam?.map ?? targets;
  let t: Target | undefined = map.get(v);
  if (t === undefined) {
    const r = Array.isArray(v);
    t = { v, n: null, h: null, k: null, p: null, r, _fam: fam, dk: null, s: false };
    t.p = new Proxy(r ? [] : {}, traps(t));
    map.set(v, t);
  }
  return t.p;
}
const wrap = thinWrap;
function child(t: Target, v: any): any {
  return isWrappable(v) && !isRawValue(v) ? wrap(v, t._fam) : v;
}
/** The scopes with an open setter: a family, or PLAIN for every plain store
 * (plain stores share one raw-to-target map, so they share one scope). A
 * read of a store outside the open scopes is an ordinary read (a derive
 * reading another store tracks it). */
const PLAIN = {};
let scopes: object[] = [];
const scopeOf = (t: Target): object => t._fam ?? PLAIN;
const inDraft = (t: Target): boolean =>
  (writing !== 0 && scopes.includes(scopeOf(t))) || (writeOverride && t._fam !== null);
export const unwrapThin = (v: any): any => v?.[$THIN]?.v ?? v;

/** The reader's frame of a node: the draft reads its own staging; everyone
 * else reads through core (tracked or not: a pass joins a hold either way). */
function peek(node: Signal<any>, t: Target): any {
  // An optimistic family's user draft composes on what the user sees.
  if (guessed !== null && userWrite && t._fam?.opt && inDraft(t)) return guessed(node);
  if (inDraft(t)) return node._pendingValue !== NOT_PENDING ? node._pendingValue : node._value;
  return tracking ? untrack(() => read(node)) : read(node);
}
function seed(t: Target, key: PropertyKey): any {
  return hasOwn.call(t.v, key) ? t.v[key] : ABSENT;
}
function nodeOf(t: Target, key: PropertyKey): Signal<any> {
  const n = (t.n ??= Object.create(null) as Record<PropertyKey, Signal<any>>);
  let node = n[key];
  if (node === undefined) {
    node = n[key] = signal(seed(t, key), nodeOpts);
    if (t._fam !== null) t._fam.live.add(t as any);
  }
  return node;
}
/** The logical value of `key` in the reader's frame (ABSENT when not own). */
function valueOf(t: Target, key: PropertyKey): any {
  const node = t.n?.[key];
  return node !== undefined ? peek(node, t) : seed(t, key);
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
  const out = keys.filter(key => n[key] === undefined || peek(n[key], t) !== ABSENT);
  for (const key of Reflect.ownKeys(n))
    if (!hasOwn.call(t.v, key) && peek(n[key], t) !== ABSENT) out.push(key);
  return out;
}
function track(t: Target): void {
  if (!inDraft(t) && getObserver() !== null) {
    if (t.k === null) {
      t.k = signal(0, nodeOpts);
      if (t._fam !== null) t._fam.live.add(t as any);
    }
    read(t.k);
  }
}
/** One node write: core stages it. A derive's own write is its derive's
 * (held with it, or a lane's work) — `holdWithDerive`, as in store.ts. */
function put(t: Target, node: Signal<any>, v: any): void {
  if (directCommit) {
    node._value = typeof v === "function" ? v(node._value) : v;
    return;
  }
  // An optimistic family's user write is a guess (core's, per node: two
  // actions writing different keys never entangle); the derive's writes are
  // the truth beneath.
  if (guess !== null && userWrite && t._fam?.opt) guess(node, v);
  else {
    setSignal(node, v);
    if (t._fam !== null && !userWrite) holdWithDerive(t, node);
  }
}
function write(t: Target, key: PropertyKey, v: any): void {
  if (t.n?.[key] === undefined && seed(t, key) === v) return;
  const node = nodeOf(t, key);
  const prev = peek(node, t);
  if (prev === v) return;
  put(t, node, () => v);
  const h = t.h?.[key];
  if (h !== undefined) put(t, h, v !== ABSENT);
  // Structure: membership for records; position is content for arrays.
  if (t.k !== null && (t.r ? key !== "length" : prev === ABSENT || v === ABSENT))
    put(t, t.k, (x: number) => x + 1);
}

// ---------------------------------------------------------------------------
// derived stores: ported from store.ts as-is (they speak core nodes only)

function linkedTo(c: Computed<any>, n: Signal<any>): boolean {
  for (let s = n._subs; s !== null; s = s._nextSub) if (s._sub === c) return true;
  return false;
}

/** store.ts `pullFamily`: bring the derive up to date before serving. */
function pullFamily(t: Target): void {
  const fw = t._fam!.node;
  if (fw === null || inDraft(t)) return;
  if (fw._statusFlags & (STATUS_PENDING | STATUS_ERROR) || fw._config & CONFIG_STAGED_ERROR) {
    const c: any = context;
    if (
      c !== null &&
      c._type === EFFECT_RENDER &&
      fw._statusFlags & STATUS_PENDING &&
      fw._config & CONFIG_HELD &&
      flushTransaction !== txOf(fw) &&
      !linkedTo(c, fw)
    )
      return;
    if (c?._deps !== undefined && fw._config & CONFIG_STAGED_ERROR) link(fw, c);
    if (
      observeFlightHook &&
      fw._config & CONFIG_VERDICT &&
      !(fw._flags & (EFFECT_RENDER << 21)) &&
      tracking
    )
      for (let l = fw._deps; l; l = l._nextDep)
        if ((l._dep as Computed<any>)._statusFlags & STATUS_PENDING) read(l._dep);
    read(fw);
  } else {
    let r: any = context;
    if (r?._root) r = r._parentComputed;
    if (r) pullComputed(fw, r);
    untrack(() => read(fw));
    if (
      observeFlightHook &&
      fw._config & CONFIG_VERDICT &&
      !(fw._flags & (EFFECT_RENDER << 21)) &&
      tracking
    ) {
      const fam = t._fam!;
      fam.w = 0;
      for (let l = fw._deps; l; l = l._nextDep)
        if ((l._dep as Computed<any>)._statusFlags & STATUS_PENDING) ((fam.w = 1), read(l._dep));
    }
  }
}

/** store.ts `holdWithDerive`: a derive's staging is its derive's. */
function holdWithDerive(t: Target, node: Signal<any>): void {
  const fw = t._fam!.node;
  if (
    laneStageHook &&
    passLane !== null &&
    node._pendingValue !== NOT_PENDING &&
    !(node._config & CONFIG_OVERRIDE)
  ) {
    list(node, passLane);
    node._config |= CONFIG_OVERRIDE;
    return;
  }
  if (
    fw !== null &&
    fw._config & CONFIG_HELD &&
    node._pendingValue !== NOT_PENDING &&
    !(node._config & (CONFIG_HELD | CONFIG_OVERRIDE))
  ) {
    holdNode(node, txOf(fw));
    node._x!._reask = fw._x!._reask;
  }
}

export function thinRunDirect(fn: () => void): void {
  const was = directCommit;
  directCommit = true;
  try {
    fn();
  } finally {
    directCommit = was;
  }
}

function traps(t: Target): ProxyHandler<any> {
  return {
    get(_, key, receiver) {
      if (key === $THIN) return t;
      if (key === $PROXY) return receiver;
      if (key === $REFRESH) return t._fam?.node ?? undefined;
      if (t._fam !== null) pullFamily(t);
      if (key === $TRACK) return (track(t), undefined);
      let node = t.n?.[key];
      const tracked = !inDraft(t) && getObserver() !== null;
      if (node === undefined) {
        const own = hasOwn.call(t.v, key);
        // Accessors and prototype members run against the proxy.
        if (own ? lookupGetter.call(t.v, key) !== undefined : key in t.v) {
          const v = Reflect.get(t.v, key, receiver);
          return typeof v === "function" ? v : child(t, v);
        }
        if (!tracked) return own ? child(t, t.v[key]) : undefined;
        node = nodeOf(t, key);
      }
      const v = tracked ? read(node) : peek(node, t);
      return v === ABSENT ? undefined : child(t, v);
    },
    has(_, key) {
      if (key === $THIN || key === $PROXY || key === $TRACK) return true;
      if (t._fam !== null) pullFamily(t);
      if (!inDraft(t) && getObserver() !== null) {
        const h = (t.h ??= Object.create(null) as Record<PropertyKey, Signal<boolean>>);
        if (h[key] === undefined) {
          h[key] = signal(valueOf(t, key) !== ABSENT, nodeOpts);
          if (t._fam !== null) t._fam.live.add(t as any);
        }
        return read(h[key]);
      }
      const v = valueOf(t, key);
      return v !== ABSENT || (!hasOwn.call(t.v, key) && key in t.v);
    },
    ownKeys() {
      if (t._fam !== null) pullFamily(t);
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
        value: child(t, v),
        writable: true,
        enumerable: d ? d.enumerable : true,
        configurable: true
      };
    },
    set(_, key, value) {
      if (!inDraft(t) || key === "__proto__") return true;
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
      if (inDraft(t)) write(t, key, ABSENT);
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

export function thinSetter<T>(proxy: T, fn: (draft: T) => T | void, guard = true): void {
  const prevUser = userWrite;
  userWrite = guard;
  const t0: Target = (proxy as any)[$THIN];
  scopes.push(scopeOf(t0));
  writing++;
  try {
    const result: any = fn(proxy);
    if (result !== undefined && result !== proxy && isWrappable(result)) {
      const t: Target = (proxy as any)[$THIN];
      t._fam?.key !== undefined
        ? thinReconcile(proxy, result, t._fam.key ?? null)
        : replace(t, unwrapThin(result));
    }
  } finally {
    writing--;
    scopes.pop();
    userWrite = prevUser;
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
      const pk = keyFn(wrap(pv, t._fam));
      if (pk !== undefined && pk !== keyFn(nv)) return nv;
    }
    thinReconcile(wrap(pv, t._fam), nv, keyFn);
    return pv;
  };
  if (t.r) {
    const len = valueOf(t, "length");
    let byKey: Map<any, any> | null = null;
    for (let i = 0; i < next.length; i++) {
      const nv = next[i];
      let pv = i < len ? valueOf(t, i) : undefined;
      const nk = keyFn !== null && isWrappable(nv) ? keyFn(nv) : undefined;
      if (nk !== undefined && !(isWrappable(pv) && keyFn!(wrap(pv, t._fam)) === nk)) {
        if (byKey === null) {
          byKey = new Map();
          for (let j = 0; j < len; j++) {
            const p = valueOf(t, j);
            const k = isWrappable(p) ? keyFn!(wrap(p, t._fam)) : undefined;
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
export function thinSnapshot(
  value: any,
  seen = new Map<object, any>(),
  fam: StoreFamily | null = value?.[$THIN]?._fam ?? null
): any {
  const raw = unwrapThin(value);
  if (!isWrappable(raw)) return raw;
  const t: Target | undefined = ((fam?.map as any) ?? targets).get(raw);
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
    const s = thinSnapshot(v, seen, fam);
    if (s !== v) (start(), (copy[k] = s));
  }
  return copy ?? raw;
}
