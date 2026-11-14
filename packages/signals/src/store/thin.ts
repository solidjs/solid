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
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_SLOT_NODE,
  CONFIG_OVERRIDE,
  CONFIG_STAGED_ERROR,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  NOT_PENDING,
  STATUS_ERROR,
  STATUS_PENDING
} from "../core/constants.js";
import {
  context,
  isEqual,
  pullComputed,
  read,
  setSignal,
  signal,
  slotSignal,
  tracking,
  untrack,
  verdict
} from "../core/core.js";
import { link, setSlotUnobserved, slotUnobservedHook } from "../core/graph.js";
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
// Slot release is not built in the spike: a thin node stays. Another
// engine's slot nodes (an old store's `px` target) go to its hook.
const prevSlotHook = slotUnobservedHook;
setSlotUnobserved((node: any) => ("px" in node._host ? prevSlotHook?.(node) : undefined));
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
  /** chained: the store a derive returned, read through live (#2941) */
  c: any;
  /** chain version: bumped when the chain switches */
  cv: Signal<number> | null;
  /** the proxy handler (swapped for the chain's) */
  hd: ProxyHandler<any> | null;
}
/** A chained target's key with no own value reads the chained store. */
const DELEGATE = {};

const targets = new WeakMap<object, Target>();
const hasOwn = Object.prototype.hasOwnProperty;
const lookupGetter = (Object.prototype as any).__lookupGetter__;
const nodeOpts = { ownedWrite: true };
let writing = 0;
/** Optimistic families' guess hooks (thinOptimistic.ts installs them), so a
 * bundle without optimistic stores carries no guess engine. */
let guess: ((n: Signal<any>, v: any) => void) | null = null;
let guessed: ((n: Signal<any>) => any) | null = null;
let under: ((n: Signal<any>) => any) | null = null;
export function installThinGuesses(w: typeof guess, g: typeof guessed, u: typeof under): void {
  guess = w;
  guessed = g;
  under = u;
}
/** The open setter is a user's (not the derive's draft or landing). */
let userWrite = false;
/** A derive's first, synchronous pass: its writes are the seed. */
let directCommit = false;

const thinProxies = new WeakSet<object>();
/** A thin store proxy (asked without a trap: another engine's proxy would
 * answer a symbol read with a node). */
export const isThin = (v: any): boolean => thinProxies.has(v);
export function thinWrap(v: any, fam: StoreFamily | null = null): any {
  const map: WeakMap<object, any> = fam?.map ?? targets;
  let t: Target | undefined = map.get(v);
  if (t === undefined) {
    const r = Array.isArray(v);
    t = {
      v,
      n: null,
      h: null,
      k: null,
      p: null,
      r,
      _fam: fam,
      dk: null,
      s: false,
      c: null,
      cv: null,
      hd: null
    };
    t.p = new Proxy(r ? [] : {}, (t.hd = traps(t)));
    thinProxies.add(t.p);
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
export const unwrapThin = (v: any): any => (thinProxies.has(v) ? v[$THIN].v : v);

/** The reader's frame of a node: the draft reads its own staging; everyone
 * else reads through core (tracked or not: a pass joins a hold either way). */
function peek(node: Signal<any>, t: Target, mode = 0): any {
  // An optimistic family's user draft composes on what the user sees.
  if (guessed !== null && t._fam?.opt && inDraft(t)) {
    if (userWrite) {
      // An action's read of a live guess is noted (#4788, D-33): core's
      // read does it outside a computation.
      // A presence read (mode 2) notes only a guess that changed presence (#4812).
      const v = guessed(node);
      if (
        mode &&
        node._config & CONFIG_GUESS &&
        context === null &&
        (mode === 1 || (v === ABSENT) !== (under!(node) === ABSENT))
      )
        read(node);
      return v;
    }
    // The derive writes the truth: it composes on the truth beneath a guess.
    if (node._config & CONFIG_GUESS) return under!(node);
  }
  if (
    inDraft(t) ||
    ((globalThis as any).THIN_LEAK && !tracking && getObserver() === null && !(node as any)._subs)
  )
    return node._pendingValue !== NOT_PENDING ? node._pendingValue : node._value;
  return tracking ? untrack(() => read(node)) : read(node);
}
function seed(t: Target, key: PropertyKey): any {
  return t.c !== null ? DELEGATE : hasOwn.call(t.v, key) ? t.v[key] : ABSENT;
}
/** The chained store's raw value of `key` (ABSENT when not own). */
const innerValue = (t: Target, key: PropertyKey): any => valueOf(t.c[$THIN], key);
function nodeOf(t: Target, key: PropertyKey, init: any = seed(t, key)): Signal<any> {
  const n = (t.n ??= Object.create(null) as Record<PropertyKey, Signal<any>>);
  let node = n[key];
  if (node === undefined) {
    // The store's one-literal slot node (px/pxv wrap cache pre-shaped).
    node = n[key] = slotSignal(init, isEqual, t, key, false);
    if (t._fam !== null) t._fam.live.add(t as any);
  }
  return node;
}
/** The logical value of `key` in the reader's frame (ABSENT when not own). */
function valueOf(t: Target, key: PropertyKey, mode = 0): any {
  const node = t.n?.[key];
  const v = node !== undefined ? peek(node, t, mode) : seed(t, key);
  return v === DELEGATE ? innerValue(t, key) : v;
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
  if (t.c !== null) {
    const out = keysOf(t.c[$THIN]).filter(key => valueOf(t, key) !== ABSENT);
    if (n !== null)
      for (const key of Reflect.ownKeys(n))
        if (!out.includes(key as any) && valueOf(t, key) !== ABSENT) out.push(key as any);
    return out;
  }
  const keys = Reflect.ownKeys(t.v);
  if (n === null) return keys;
  const out = keys.filter(key => n[key] === undefined || peek(n[key], t, 2) !== ABSENT);
  for (const key of Reflect.ownKeys(n))
    if (!hasOwn.call(t.v, key) && peek(n[key], t, 2) !== ABSENT) out.push(key);
  return out;
}
function track(t: Target): void {
  if (!inDraft(t) && getObserver() !== null) {
    if (t.k === null) {
      t.k = slotSignal(0, isEqual, t, $TRACK, false);
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
  if (guess !== null && userWrite && t._fam?.opt) {
    guess(node, v);
    ((t._fam as any).g ??= new Set()).add(node);
  } else {
    setSignal(node, v);
    if (t._fam !== null && !userWrite) holdWithDerive(t, node);
  }
}
function write(t: Target, key: PropertyKey, v: any): void {
  if (t.n?.[key] === undefined && seed(t, key) === v) return;
  const node = nodeOf(t, key);
  let prev = peek(node, t);
  if (prev === DELEGATE) prev = innerValue(t, key);
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

export function linkedTo(c: Computed<any>, n: Signal<any>): boolean {
  for (let s = n._subs; s !== null; s = s._nextSub) if (s._sub === c) return true;
  return false;
}

/** store.ts `pullFamily`: bring the derive up to date before serving. */
/** The optimistic engine's judgement (thinOptimistic.ts): the family's
 * guesses stand in for its flight (A17). */
let stands: (t: Target) => boolean = () => false;
export function installThinStands(fn: typeof stands): void {
  stands = fn;
}
function pullFamily(t: Target): void {
  const fw = t._fam!.node;
  if (fw === null || inDraft(t)) return;
  if (fw._statusFlags & (STATUS_PENDING | STATUS_ERROR) || fw._config & CONFIG_STAGED_ERROR) {
    // Guesses that stand in for the flight (A17) are the display: a reader
    // is served the leaves and does not suspend on the derive.
    if (verdict === null && fw._statusFlags & STATUS_PENDING && stands(t)) return;
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
      const v = tracked ? read(node) : peek(node, t, 1);
      if (v === null || typeof v !== "object") return v === ABSENT ? undefined : v;
      if ((node as any).pxv === v) return (node as any).px;
      const p = child(t, v);
      (node as any).px = p;
      (node as any).pxv = v;
      return p;
    },
    has(_, key) {
      if (key === $THIN || key === $PROXY || key === $TRACK) return true;
      if (t._fam !== null) pullFamily(t);
      if (!inDraft(t) && getObserver() !== null) {
        const h = (t.h ??= Object.create(null) as Record<PropertyKey, Signal<boolean>>);
        if (h[key] === undefined) {
          h[key] = slotSignal(valueOf(t, key) !== ABSENT, isEqual, t, key, false);
          if (t._fam !== null) t._fam.live.add(t as any);
        }
        return read(h[key]);
      }
      const v = valueOf(t, key, 2);
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

/** A chained target's traps: a key with no own value reads the chained
 * store's proxy (its identity, its nodes: inner writes flow with no
 * re-derive, #2941); a switch of chain notifies through `cv`. */
function chainTraps(t: Target, base: ProxyHandler<any>): ProxyHandler<any> {
  const inner = (fn: () => any): any => (inDraft(t) ? untrack(fn) : fn());
  const tracked = (): boolean => {
    if (inDraft(t) || getObserver() === null) return false;
    read((t.cv ??= slotSignal(0, isEqual, t, $PROXY, false)));
    return true;
  };
  const get = (_: any, key: PropertyKey, receiver: any): any => {
    if (key === $THIN || key === $PROXY || key === $REFRESH) return base.get!(_, key, receiver);
    if (t._fam !== null) pullFamily(t);
    const tr = tracked();
    if (key === $TRACK) return (track(t), inner(() => t.c[$TRACK]));
    let node = t.n?.[key];
    // A prototype member (an array method) is the chained store's.
    const it: Target = t.c[$THIN];
    if (node === undefined && !hasOwn.call(it.v, key) && it.n?.[key] === undefined && key in it.v)
      return t.c[key];
    if (node === undefined && tr) node = nodeOf(t, key);
    const v = node === undefined ? DELEGATE : tr ? read(node) : peek(node, t);
    if (v === DELEGATE) return inner(() => t.c[key]);
    return v === ABSENT ? undefined : child(t, v);
  };
  const has = (_: any, key: PropertyKey): boolean => {
    if (key === $THIN || key === $PROXY || key === $TRACK) return true;
    if (t._fam !== null) pullFamily(t);
    const tr = tracked();
    let node = t.n?.[key];
    if (node === undefined && tr) node = nodeOf(t, key);
    const v = node === undefined ? DELEGATE : tr ? read(node) : peek(node, t);
    return v === DELEGATE ? inner(() => key in t.c) : v !== ABSENT;
  };
  return {
    get,
    has,
    ownKeys() {
      if (t._fam !== null) pullFamily(t);
      if (tracked()) (track(t), Reflect.ownKeys(t.c));
      return keysOf(t);
    },
    getOwnPropertyDescriptor(_, key) {
      if (t.r && key === "length")
        return { value: valueOf(t, key), writable: true, enumerable: false, configurable: false };
      if (!has(_, key)) return undefined;
      return { value: get(_, key, t.p), writable: true, enumerable: true, configurable: true };
    }
  };
}
const baseTraps = new WeakMap<Target, ProxyHandler<any>>();
function chainTo(t: Target, next: any): void {
  if (t.c === next) return;
  if (!baseTraps.has(t)) baseTraps.set(t, { ...t.hd! });
  const was = t.c;
  t.c = next;
  Object.assign(t.hd!, chainTraps(t, baseTraps.get(t)!));
  // Own values give way to the chain's (a guess or a pending write too).
  if (t.n !== null) for (const key of Reflect.ownKeys(t.n)) put(t, t.n[key as any], () => DELEGATE);
  if (was === null && t.k !== null) put(t, t.k, (x: number) => x + 1);
  if (t.cv !== null) put(t, t.cv, (x: number) => x + 1);
}
/** Leave the chain: every key takes the value it showed as its own. */
function unchain(t: Target): void {
  const it = t.c[$THIN] as Target;
  const fix = (node: Signal<any>, key: PropertyKey) => {
    if (node._value === DELEGATE) node._value = valueOf(it, key);
    if (node._pendingValue === DELEGATE) node._pendingValue = valueOf(it, key);
  };
  if (t.n !== null) for (const key of Reflect.ownKeys(t.n)) fix(t.n[key as any], key);
  for (const key of keysOf(it)) if (t.n?.[key] === undefined) nodeOf(t, key, valueOf(it, key));
  // A seed key the chain lacks reads absent too.
  for (const key of Reflect.ownKeys(t.v))
    if (t.n?.[key as any] === undefined) nodeOf(t, key, ABSENT);
  t.c = null;
  Object.assign(t.hd!, baseTraps.get(t)!);
  if (t.cv !== null) put(t, t.cv, (x: number) => x + 1);
}

function replace(t: Target, next: any): void {
  if (next === t.v && t.n === null) return;
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
export function thinReconcile(
  proxy: any,
  next: any,
  keyFn: ((v: any) => any) | null,
  root: 0 | 1 | 2 = 1 // nested | root (a different entity swaps) | user root (throws)
): void {
  const t: Target = proxy[$THIN];
  // A derive returned a store: chain to it (#2941); a plain value ends a chain.
  if (root === 1 && t._fam !== null) {
    if (isThin(next) && next[$THIN]._fam !== t._fam) return chainTo(t, next);
    if (t.c !== null) unchain(t);
  }
  next = unwrapThin(next);
  if (next === t.v && t.n === null) return;
  if (root && keyFn !== null) {
    const k = keyFn(proxy);
    if (k !== undefined && k !== keyFn(next)) {
      if (root > 1)
        throw new Error(__DEV__ ? "Cannot reconcile states with different identity" : "");
      return replace(t, next);
    }
  }
  const map: WeakMap<object, any> = (t._fam?.map as any) ?? targets;
  // Descend only where a proxy exists below: a subtree nobody read has no
  // identity or readers to keep, so the new value just takes the slot.
  const merge = (pv: any, nv: any): any => {
    // A store inside a derive's value: the slot chains to it (#2864).
    if (t._fam !== null && isThin(nv) && nv[$THIN]._fam !== t._fam) {
      let pt: Target | undefined = isWrappable(pv) ? map.get(pv) : undefined;
      if (pt === undefined || pt.r !== Array.isArray(nv)) {
        pv = Array.isArray(nv) ? [] : {};
        thinWrap(pv, t._fam);
        pt = map.get(pv)!;
      }
      chainTo(pt!, nv);
      return pv;
    }
    nv = unwrapThin(nv);
    if (
      pv === nv ||
      !isWrappable(pv) ||
      !isWrappable(nv) ||
      Array.isArray(pv) !== Array.isArray(nv)
    )
      return nv;
    const pt = map.get(pv);
    if (pt === undefined) return nv;
    if (keyFn !== null) {
      const pk = keyFn(pt.p);
      if (pk !== undefined && pk !== keyFn(nv)) return nv;
    }
    thinReconcile(pt.p, nv, keyFn, 0);
    return pv;
  };
  const keyOf = (p: any): any => {
    if (!isWrappable(p)) return undefined;
    const pt = map.get(p);
    return keyFn!(pt !== undefined ? pt.p : p);
  };
  if (t.r) {
    const len = valueOf(t, "length");
    let byKey: Map<any, any> | null = null;
    for (let i = 0; i < next.length; i++) {
      const nv = next[i];
      let pv = i < len ? valueOf(t, i) : undefined;
      const nk = keyFn !== null && isWrappable(nv) ? keyFn(nv) : undefined;
      if (nk !== undefined && keyOf(pv) !== nk) {
        if (byKey === null) {
          byKey = new Map();
          for (let j = 0; j < len; j++) {
            const p = valueOf(t, j);
            const k = keyOf(p);
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
  fam: StoreFamily | null = isThin(value) ? value[$THIN]._fam : null
): any {
  const raw = unwrapThin(value);
  if (!isWrappable(raw)) return raw;
  const t: Target | undefined = ((fam?.map as any) ?? targets).get(raw);
  if (t === undefined) return raw;
  if (seen.has(raw)) return seen.get(raw);
  if (t.c !== null) {
    const it: Target = t.c[$THIN];
    const copy: any = t.r ? [] : Object.create(Object.getPrototypeOf(raw));
    seen.set(raw, copy);
    if (t.r) copy.length = valueOf(t, "length");
    for (const k of keysOf(t)) {
      if (t.r && k === "length") continue;
      const node = t.n?.[k as any];
      const own = node !== undefined && peek(node, t) !== DELEGATE;
      copy[k] = own
        ? thinSnapshot(valueOf(t, k), seen, fam)
        : thinSnapshot(valueOf(it, k), seen, it._fam);
    }
    return copy;
  }
  seen.set(raw, raw);
  let copy: any = null;
  const keys = keysOf(t);
  const start = () => {
    if (copy === null) {
      copy = t.r ? [] : Object.create(Object.getPrototypeOf(raw));
      seen.set(raw, copy);
      if (t.r) copy.length = valueOf(t, "length");
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

/** Tracking copy: subscribes to every reachable key set and value. */
export function thinDeep(value: any, seen = new Map<object, any>()): any {
  if (!isThin(value)) return value;
  if (seen.has(value)) return seen.get(value);
  const arr = Array.isArray(value);
  const copy: any = arr ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  const keys = Reflect.ownKeys(value);
  if (arr) copy.length = value.length;
  for (const k of keys) if (!arr || k !== "length") copy[k] = thinDeep(value[k], seen);
  return copy;
}
