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
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_MANUAL_WRITE,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  CONFIG_NO_SNAPSHOT,
  REACTIVE_RECOMPUTING_DEPS,
  CONFIG_SLOT_NODE,
  CONFIG_OVERRIDE,
  CONFIG_STAGED_ERROR,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  NOT_PENDING,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "../core/constants.js";
import {
  context,
  disposalDepth,
  inRefCallback,
  isEqual,
  ownedScopeWriteMessage,
  REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE,
  strictRead,
  strictReadActive,
  pullComputed,
  read,
  setSignal,
  writeHook,
  signal,
  slotSignal,
  tracking,
  untrackDepth,
  untrack,
  verdict
} from "../core/core.js";
import {
  asyncTailFlights,
  checkPostAwaitRead,
  DEV,
  emitDiagnostic,
  devStoreSlotWriter,
  registerDevStoreSlotWriter,
  registerGraph,
  reportDiagnostic,
  warnStrictReadUntracked
} from "../core/dev.js";
import {
  attrHooks,
  registerStoreTools,
  storeTools,
  type StoreTools
} from "../core/attribution-hooks.js";
import { link, setSlotUnobserved, slotUnobservedHook } from "../core/graph.js";
import { getObserver, getOwner } from "../core/owner.js";
import { insertIntoHeap } from "../core/heap.js";
import {
  dirtyQueue,
  flushTransaction,
  GlobalQueue,
  holdNode,
  laneStageHook,
  list,
  observeFlightHook,
  passLane,
  schedule,
  txOf
} from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import { storeOwners, type StoreFamily } from "./target.js";
import { thinParents } from "./thinParents.js";
import { signalHook } from "../core/identities.js";
import { affectsHooks } from "./hooks.js";
import {
  $PROXY,
  $TARGET,
  $TRACK,
  isRawValue,
  isWrappable,
  markRaw,
  writeOverride
} from "./types.js";

import { $THIN } from "./types.js";
export { $THIN };
/** The proxy shell's back-reference to its target (one shared handler). */
const $S = Symbol();
// Slot release is not built in the spike: a thin node stays. Another
// engine's slot nodes (an old store's `px` target) go to its hook.
const prevSlotHook = slotUnobservedHook;
setSlotUnobserved((node: any) => ("px" in node._host ? prevSlotHook?.(node) : release(node)));
/** A node whose last reader let go leaves its target when the raw already
 * says what it says (#3351): nothing is lost, the next read re-creates it
 * from the seed. A target with no node leaves its family's live index. A
 * written node, or one a frame still carries, stays. */
function release(node: any): void {
  if (
    node._subs !== null ||
    node._pendingValue !== NOT_PENDING ||
    node._config & (CONFIG_OVERRIDE | CONFIG_HELD | CONFIG_GUESS) ||
    // One a lane ever carried may come back (a revert's kept guess, #4336).
    node._x !== null
  )
    return;
  const t: Target = node._host;
  const key = node._key;
  if (key === $TRACK) {
    if (t.k !== node) return;
    t.k = null;
  } else if (t.n?.[key] === node) {
    if (!Object.is(node._value, seed(t, key))) return;
    delete t.n![key];
  } else if (t.h?.[key] === node) {
    // A chained target's presence is the chain's: not released here.
    if (t.c !== null || node._value !== (valueOf(t, key) !== ABSENT)) return;
    delete t.h![key];
  } else return;
  if (t._fam !== null && t.k === null && empty(t.n) && empty(t.h)) t._fam.live.delete(t as any);
}
// A staged write to a node nobody reads: the release waits for its commit.
GlobalQueue._slotCommitted = (n: any) => ("px" in n._host ? undefined : release(n));
const empty = (m: object | null): boolean => {
  if (m !== null) for (const _ in m) return false;
  return m === null || Object.getOwnPropertySymbols(m).length === 0;
};
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
  /** written: a node may differ from the raw */
  w?: boolean;
  /** a node exists for a key the raw lacks */
  x?: boolean;
  /** prototype node (a class member read, or a swap) */
  o?: Signal<any>;
}
/** A chained target's key with no own value reads the chained store. */
const DELEGATE = {};

const targets = new WeakMap<object, Target>();
const hasOwn = Object.prototype.hasOwnProperty;
const lookupGetter = (Object.prototype as any).__lookupGetter__;
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable;
const nodeOpts = { ownedWrite: true };
let writing = 0;
/** Optimistic families' guess hooks (thinOptimistic.ts installs them), so a
 * bundle without optimistic stores carries no guess engine. */
let guess: ((n: Signal<any>, v: any) => void) | null = null;
let guessed: ((n: Signal<any>) => any) | null = null;
let under: ((n: Signal<any>) => any) | null = null;
let echo: ((a: any, b: any) => boolean) | null = null;
export function installThinGuesses(
  w: typeof guess,
  g: typeof guessed,
  u: typeof under,
  e: typeof echo
): void {
  echo = e;
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
export const isThin = (v: any): boolean =>
  v !== null && typeof v === "object" && v[$THIN] !== undefined;
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
    const shell: any = r ? [] : {};
    shell[$S] = t;
    t.p = new Proxy(shell, BASE);
    map.set(v, t);
  }
  return t.p;
}
const wrap = thinWrap;
/** Dev: each target's root (the first store it was reached from), the
 * holder the post-await read warning reports once per (store.ts `storeRoot`). */
const devRoot: WeakMap<Target, Target> | null = __DEV__ ? new WeakMap() : null;
function child(t: Target, v: any): any {
  if (t.s) {
    // A shallow slot serves verbatim; a store placed in it is served
    // through the slot's chain to it (#2932: each level its own proxies).
    const ct: Target | undefined =
      t._fam !== null && isWrappable(v) ? (t._fam.map.get(v) as any) : undefined;
    return ct !== undefined && ct.c !== null ? ct.p : v;
  }
  if (!isWrappable(v) || isRawValue(v)) return v;
  const p = wrap(v, t._fam);
  if (__DEV__) {
    const ct: Target = p[$THIN];
    if (ct !== t && !devRoot!.has(ct)) devRoot!.set(ct, devRoot!.get(t) ?? t);
  }
  return p;
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
export const unwrapThin = (v: any): any => (isThin(v) ? v[$THIN].v : v);

/** The reader's frame of a node: the draft reads its own staging; everyone
 * else reads through core (tracked or not: a pass joins a hold either way). */
/** The `affects()` walk reads the writer's view (the tick's guesses too). */
let writerView = false;
function peek(node: Signal<any>, t: Target, mode = 0): any {
  if (writerView && guessed !== null && t._fam?.opt) return guessed(node);
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
  // Dev: a read after an await is reported by the trap, once per store
  // (core's per-node report is skipped under untrack).
  return tracking || (__DEV__ && asyncTailFlights !== 0) ? untrack(() => read(node)) : read(node);
}
function seed(t: Target, key: PropertyKey): any {
  // An own accessor seeds as its descriptor, so a tracked reader holds a
  // node that a data write replaces (#3949).
  return t.c !== null
    ? DELEGATE
    : !hasOwn.call(t.v, key)
      ? ABSENT
      : lookupGetter.call(t.v, key) !== undefined
        ? new Box(Object.getOwnPropertyDescriptor(t.v, key)!)
        : t.v[key];
}
/** The chained store's raw value of `key` (ABSENT when not own). */
const innerValue = (t: Target, key: PropertyKey): any => valueOf(t.c[$THIN], key);
function nodeOf(t: Target, key: PropertyKey, init: any = seed(t, key)): Signal<any> {
  const n = (t.n ??= Object.create(null) as Record<PropertyKey, Signal<any>>);
  let node = n[key];
  if (node === undefined) {
    // The store's one-literal slot node (px/pxv wrap cache pre-shaped).
    node = n[key] = slot(t, init, Object.is, key);
    if (!hasOwn.call(t.v, key)) t.x = true;
    if (t._fam !== null) t._fam.live.add(t as any);
  }
  return node;
}
/** The reader linked the key-set node in this pass (store.ts
 * `observerHoldsContainer`). */
function holdsKeys(t: Target): boolean {
  const k = t.k;
  const obs: any = getObserver();
  if (k === null || obs === null || inDraft(t)) return false;
  const l: any = k._subsTail;
  return (
    l !== null &&
    l._sub === obs &&
    (!(obs._flags & REACTIVE_RECOMPUTING_DEPS) || l._gen === obs._depGen)
  );
}
/** A target's node. A derived store's are the derive's own work: a write
 * to one during hydration's capture is no client write to hold (core
 * `captureWriteSnapshot`; the deep engine's leaves never reach it). */
// Observe: a target's first parent and key (the path attribution names it
// by), the root's declared name and loc.
const obsParent = thinParents as unknown as WeakMap<Target, [Target, PropertyKey]>;
const obsNames = __OBSERVE__ ? new WeakMap<Target, string>() : null;
const obsLocs = __OBSERVE__ ? new WeakMap<Target, string>() : null;
function rootOf(t: Target): Target {
  for (let p; (p = obsParent.get(t)) !== undefined; ) t = p[0];
  return t;
}
function noteParent(c: any, t: Target, key: PropertyKey): void {
  const ct: Target | undefined = c?.[$THIN];
  if (ct !== undefined && ct !== t && !obsParent.has(ct) && rootOf(t) !== ct)
    obsParent.set(ct, [t, key]);
}
/** A store's declared name and loc (store.ts `nameStore`). */
export function thinNameStore(proxy: any, name?: string, loc?: string): void {
  if (__OBSERVE__ && attrHooks !== null) {
    if (name) obsNames!.set(proxy[$THIN], name);
    if (loc) obsLocs!.set(proxy[$THIN], loc);
  }
}
let internalWrite = false;
/** createStore's observe registration (store.ts): owner graph, name, loc. */
export function thinObserveStore(proxy: any, options?: { name?: string; loc?: string }): void {
  if (!__OBSERVE__) return;
  const owner = getOwner();
  internalWrite = true;
  registerGraph(proxy, owner);
  internalWrite = false;
  if (attrHooks !== null) {
    const t: Target = proxy[$THIN];
    storeOwners!.set(t as any, owner);
    thinNameStore(proxy, options?.name, options?.loc);
  }
  if (!toolsWrapped) wrapTools();
  if (__DEV__ && !writerChained) chainDevWriter();
}
let toolsWrapped = false;
/** The attribution engine's store tools answer thin targets too (the deep
 * store registers them; a thin target has no `px`). */
function wrapTools(): void {
  toolsWrapped = true;
  const deep: StoreTools | null = storeTools;
  const thin = (x: any): boolean => x !== null && typeof x === "object" && !("px" in x);
  const pick = <K extends keyof StoreTools>(k: K, f: StoreTools[K]): StoreTools[K] =>
    ((...a: any[]) =>
      thin(a[0]) || deep === null ? (f as any)(...a) : (deep[k] as any)(...a)) as any;
  registerStoreTools({
    pathOf: pick("pathOf", (t: any) => {
      let path = "";
      for (let p; (p = obsParent.get(t)) !== undefined; t = p[0]) path = "." + String(p[1]) + path;
      return "store" + path;
    }),
    isShallow: pick("isShallow", (t: any) => t.s),
    deleted: pick("deleted", () => null),
    rootOwner: pick("rootOwner", (t: any) => storeOwners!.get(rootOf(t) as any)),
    ownerKey: deep?.ownerKey ?? Symbol(),
    unwrapValue: (v: any) => (isThin(v) ? v[$THIN].v : deep ? deep.unwrapValue(v) : v),
    targetsEqual: (a: any, b: any) =>
      isThin(a) || isThin(b) ? unwrapThin(a) === unwrapThin(b) : !!deep?.targetsEqual(a, b),
    isRawValue: (v: any) => (deep ? deep.isRawValue(v) : isRawValue(v)),
    isWrappable: (v: any) => isWrappable(v)
  });
}
function slot<V>(t: Target, v: V, eq: (a: V, b: V) => boolean, key: PropertyKey): Signal<V> {
  const s = slotSignal(v, eq, t, key, false);
  if (t._fam !== null) s._config |= CONFIG_NO_SNAPSHOT;
  // Attribution names a value node by its store path segment and places it
  // under the root's owner (store.ts `getNode`); engine installed only.
  if (__OBSERVE__ && attrHooks !== null) {
    const r = rootOf(t);
    if (typeof key !== "symbol")
      (s as any)._name = (obsNames!.get(r) ?? "store") + "." + String(key);
    (s as any)._loc = obsLocs!.get(r);
    (s as any)._owner = storeOwners!.get(r as any) ?? null;
  }
  // A node born on a record a live `affects()` mark covers inherits it.
  if (affectsHooks !== null) affectsHooks._born(t as any, s, key);
  return s;
}
/** The thin half of `affects(store[, key])` (store/affects.ts `storeMarks`):
 * keyed, the slot's node and the record's identity; keyless, a carrier node
 * and every live node reachable, the raws reachable as the scope. */
export function thinMarks(
  t: Target,
  key: PropertyKey | undefined,
  carrierKey: PropertyKey,
  scopeOf: (n: any, k: PropertyKey | undefined) => { _scope: Set<object> }
): any[] {
  const node = nodeOf(t, key === undefined ? carrierKey : key);
  const entry = scopeOf(node, key);
  if (key !== undefined) return (entry._scope.add(t.v), [node]);
  const found: Signal<any>[] = [node];
  const visited = new Set<object>();
  const walk = (v: any, fam: StoreFamily | null): void => {
    const ct: Target | undefined = isThin(v)
      ? v[$THIN]
      : isWrappable(v)
        ? ((fam?.map as any) ?? targets).get(v)
        : undefined;
    const raw = ct !== undefined ? ct.v : v;
    if (!isWrappable(raw) || visited.has(raw)) return;
    visited.add(raw);
    entry._scope.add(raw);
    if (ct !== undefined) {
      if (ct.n !== null)
        for (const k of Reflect.ownKeys(ct.n)) if (k !== carrierKey) found.push(ct.n[k as any]);
      if (ct.h !== null) for (const k of Reflect.ownKeys(ct.h)) found.push(ct.h[k as any]);
      if (ct.k !== null) found.push(ct.k);
      for (const k of keysOf(ct)) {
        const cv = valueOf(ct, k);
        if (!(cv instanceof Box)) walk(cv, ct._fam ?? fam);
      }
    } else
      for (const k of Reflect.ownKeys(raw)) {
        const d = Object.getOwnPropertyDescriptor(raw, k)!;
        if (d.get === undefined) walk(d.value, fam);
      }
  };
  writerView = true;
  try {
    walk(t.p, t._fam);
  } finally {
    writerView = false;
  }
  return found;
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
    // Non-index metadata (symbols, named keys) of the array.
    const meta = (k: PropertyKey) =>
      k !== "length" && (typeof k === "symbol" || "" + (+k >>> 0) !== k);
    for (const k of Reflect.ownKeys(t.v))
      if (meta(k) && valueOf(t, k) !== ABSENT) keys.push(k as any);
    if (n !== null)
      for (const k of Reflect.ownKeys(n))
        if (meta(k) && !hasOwn.call(t.v, k) && peek(n[k as any], t, 2) !== ABSENT)
          keys.push(k as any);
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
      t.k = slot(t, 0, isEqual, $TRACK);
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
    if (t.r) listGuess?.(t);
  } else {
    // A34 (3), #3612: a user write to a derivation another transaction
    // holds is the draft's prior state; the hold re-derives over it.
    if (
      userWrite &&
      t._fam?.node &&
      (node._config & (CONFIG_HELD | CONFIG_MANUAL_WRITE)) === CONFIG_HELD &&
      txOf(node) !== flushTransaction
    )
      heldHit = t._fam.node;
    setSignal(node, v);
    // The derive's write is a derivation; a user setter's a proposal.
    if (t._fam !== null)
      userWrite
        ? (node._config |= CONFIG_MANUAL_WRITE)
        : ((node._config &= ~CONFIG_MANUAL_WRITE), holdWithDerive(t, node));
  }
}
function write(t: Target, key: PropertyKey, v: any): void {
  // No write has moved this target off its raw: every node holds the seed.
  if ((!t.w || t.n?.[key] === undefined) && Object.is(seed(t, key), v)) return;
  const node = nodeOf(t, key);
  let prev = peek(node, t);
  if (prev === DELEGATE) prev = innerValue(t, key);
  // A guess of an object the truth beneath echoes is that object (#3672):
  // its end compares against the truth's live value, not a copy's identity.
  if (echo !== null && userWrite && t._fam?.opt && isWrappable(v)) {
    const u = node._config & CONFIG_GUESS ? under!(node) : node._value;
    if (u !== v && echo(u, v)) v = u;
  }
  // A derive's landing on a guess is its truth even when the truth beneath
  // was already this (A18): the guess is judged with the rest of the
  // landing, not left over a key set the landing moved.
  if (Object.is(prev, v) && (userWrite || !(node._config & CONFIG_GUESS))) return;
  if (__DEV__ && DEV.hooks.onStoreNodeUpdate && !(t.r && key === "length"))
    DEV.hooks.onStoreNodeUpdate(
      t.p,
      key,
      v === ABSENT ? undefined : v,
      prev === ABSENT ? undefined : prev
    );
  if (__OBSERVE__ && attrHooks !== null && userWrite) noteWrite(t, key, prev, v);
  put(t, node, () => v);
  t.w = true;
  const h = t.h?.[key];
  if (h !== undefined) put(t, h, v !== ABSENT);
  // Structure: membership for records; position is content for arrays.
  if (t.k !== null && (t.r ? key !== "length" : prev === ABSENT || v === ABSENT))
    put(t, t.k, (x: number) => x + 1);
}

// ---------------------------------------------------------------------------
// derived stores: ported from store.ts as-is (they speak core nodes only)

/** For the optimistic engine (thinOptimistic.ts). */
export const nodeOfThin = (t: any, key: PropertyKey): Signal<any> => nodeOf(t, key);
export { ABSENT as ABSENT_THIN };
export function linkedTo(c: Computed<any>, n: Signal<any>): boolean {
  for (let s = n._subs; s !== null; s = s._nextSub) if (s._sub === c) return true;
  return false;
}

/** store.ts `pullFamily`: bring the derive up to date before serving. */
/** The optimistic engine's judgement (thinOptimistic.ts): the family's
 * guesses stand in for its flight (A17). */
let stands: (t: Target) => boolean | 2 = () => false;
/** A pass in a frame's hold served a list guess's values like lane work
 * (#4561): its reads of guessed leaves this pass are the guess. */
let serving: unknown = null;
/** A user's guess on a list (thinOptimistic.ts marks one written over a new
 * question's flight, #4525). */
let listGuess: ((t: Target) => void) | null = null;
export function installThinListGuess(fn: typeof listGuess): void {
  listGuess = fn;
}
export function installThinStands(fn: typeof stands): void {
  stands = fn;
}
function pullFamily(t: Target): void {
  const fw = t._fam!.node;
  if (fw === null || inDraft(t)) return;
  if (fw._statusFlags & (STATUS_PENDING | STATUS_ERROR) || fw._config & CONFIG_STAGED_ERROR) {
    // Guesses that stand in for the flight (A17) are the display: a reader
    // is served the leaves and does not suspend on the derive.
    if (verdict === null && fw._statusFlags & STATUS_PENDING) {
      const st = stands(t);
      if (st) return void (st === 2 && (serving = context));
    }
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

/** A held adoption's slot whose old and new values are the same row that
 * nothing had proxied when the adoption ran: paired at its first read, as
 * the adoption would have paired it (#3712, store.ts `adoptChild`). One
 * target over the old raw, the new raw's differing leaves staged on it
 * under the same hold; the slot reads as unchanged, so the row's own
 * leaves decide (`id` the same in both frames holds no one, #3706). */
function pairLate(t: Target, node: Signal<any>): void {
  const ov = node._value;
  const nv = node._pendingValue;
  const fam = t._fam!;
  const keyFn = t.r ? fam.key : null;
  if (
    t.s ||
    keyFn === undefined ||
    !isWrappable(ov) ||
    !isWrappable(nv) ||
    Array.isArray(ov) !== Array.isArray(nv) ||
    protoOf(ov) !== protoOf(nv) ||
    (keyFn !== null && keyFn(ov) !== keyFn(nv)) ||
    fam.map.has(ov) ||
    fam.map.has(nv)
  )
    return;
  // A raw in both frames (rows swapped or reordered) is its own row.
  for (const k of Reflect.ownKeys({ ...t.v, ...t.n })) {
    const m = t.n![k as any];
    const c = m ? m._value : t.v[k];
    if (c === nv || (m && m._pendingValue !== NOT_PENDING ? m._pendingValue : c) === ov) return;
  }
  const ct: Target = wrap(ov, fam)[$THIN];
  const x = node._x!;
  for (const k of Reflect.ownKeys({ ...ov, ...nv })) {
    const v = hasOwn.call(nv, k) ? nv[k] : ABSENT;
    if (!Object.is(hasOwn.call(ov, k) ? ov[k] : ABSENT, v)) {
      const m = nodeOf(ct, k);
      m._pendingValue = v;
      holdNode(m, x._transaction!);
      m._x!._reask = x._reask;
    }
  }
  ct.w = true;
  // The slot itself is unchanged: no longer held.
  node._pendingValue = NOT_PENDING;
  node._config &= ~CONFIG_HELD;
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

/** A draft assignment: an array's length follows its indices. */
function writeSlot(t: Target, key: PropertyKey, v: any): void {
  if (t.r) {
    const len = valueOf(t, "length");
    if (key === "length") {
      for (let i = v; i < len; i++) write(t, i, ABSENT);
    } else if (typeof key === "string" && "" + (+key >>> 0) === key) {
      if (+key >= len) write(t, "length", +key + 1);
      // D-33: the list is the slot while a guess moved its length — an
      // index write over it writes the list, so the two guesses entangle.
      else if (userWrite && carries(t.n?.length)) put(t, t.n!.length, len);
    }
  }
  write(t, key, v);
}
/** An optimistic family with a guess out. */
function famGuessing(fam: any): boolean {
  if (fam.g) for (const n of fam.g) if (carries(n)) return true;
  return false;
}
/** A property defined through a draft with a getter or non-default attributes. */
class Box {
  constructor(public d: PropertyDescriptor) {}
}
const carries = (n: any): boolean => n != null && (n._config & CONFIG_OVERRIDE) !== 0;
function hasGuess(t: Target): boolean {
  if (carries(t.k)) return true;
  if (t.n !== null) for (const k of Reflect.ownKeys(t.n)) if (carries(t.n[k as any])) return true;
  return false;
}
/** Pollution guard; `constructor` withheld from drafts only (#4670). */
const polluting = (t: Target, key: PropertyKey): boolean =>
  key === "__proto__" || key === "prototype" || (key === "constructor" && inDraft(t));
const protoOf = Object.getPrototypeOf;
const NONE = Object.create(null);
/** A record's prototype in the reader's frame: a node once a reader of a
 * class member tracks it or a reconcile swaps it (A29, #3706). */
const protoNode = (t: Target): Signal<any> =>
  (t.o ??= slot(t, protoOf(t.v), Object.is, "[[Prototype]]"));
const protoNow = (t: Target): any => (t.o ? peek(t.o, t) : protoOf(t.v));
const BASE: ProxyHandler<any> = {
  get(_, key, receiver) {
    const t: Target = _[$S];
    if (t.c !== null) return CHAIN.get!(_, key, receiver);
    if (verdict !== null && affectsHooks !== null && getObserver() === null)
      affectsHooks._witness(t as any, typeof key === "symbol" ? undefined : key);
    if (key === $THIN) return t;
    if (key === $PROXY) return receiver;
    if (key === $TARGET) return undefined; // the deep engine's brand: no node
    if (key === $REFRESH) return t._fam?.node ?? undefined;
    if (t._fam !== null) pullFamily(t);
    if (key === $TRACK) return (track(t), undefined);
    let node = t.n?.[key];
    const tracked = !inDraft(t) && getObserver() !== null;
    if (
      __DEV__ &&
      asyncTailFlights !== 0 &&
      untrackDepth === 0 &&
      typeof key === "string" &&
      key !== "then" &&
      getObserver() === null &&
      !inDraft(t) &&
      (node !== undefined || hasOwn.call(t.v, key))
    )
      checkPostAwaitRead(node, devRoot!.get(t) ?? t, undefined, key, false);
    // Dev strictRead: an untracked read in a labeled scope never updates
    // its reader (store.ts; `then` is the promise engine's probe).
    if (
      __DEV__ &&
      strictRead &&
      typeof key === "string" &&
      key !== "then" &&
      getObserver() === null &&
      !inDraft(t) &&
      strictReadActive()
    )
      warnStrictReadUntracked(strictRead, {
        nodeName: key,
        data: { strictRead, property: key, source: "store" }
      });
    if (node === undefined) {
      const own = hasOwn.call(t.v, key);
      // Pollution guard; `constructor` withheld from drafts only (#4670).
      if (!own && polluting(t, key)) return undefined;
      // Accessors and prototype members run against the proxy.
      let pr: any = t.v;
      if (!own && !t.r && (t.o || protoOf(t.v) !== Object.prototype))
        pr = (tracked ? read(protoNode(t)) : protoNow(t)) ?? NONE;
      if (own ? !tracked && lookupGetter.call(t.v, key) !== undefined : key in pr) {
        const v = Reflect.get(pr, key, receiver);
        return typeof v === "function" ? v : child(t, v);
      }
      if (!tracked) {
        if (!own) return undefined;
        const p = child(t, t.v[key]);
        if ((__OBSERVE__ && attrHooks !== null) || signalHook !== null) noteParent(p, t, key);
        return p;
      }
      node = nodeOf(t, key);
    }
    if ((node._config & (CONFIG_HELD | CONFIG_GUESS)) === CONFIG_HELD && t._fam !== null)
      pairLate(t, node);
    let v = tracked ? read(node) : peek(node, t, 1);
    if (serving !== null && serving === context && node._config & CONFIG_GUESS) v = guessed!(node);
    if (v === null || typeof v !== "object")
      // A removed own key reads what the prototype says (#4674 ruling).
      return v !== ABSENT
        ? v
        : polluting(t, key)
          ? undefined
          : Reflect.get(protoOf(t.v) ?? {}, key, receiver);
    if ((node as any).pxv === v) return (node as any).px;
    if (v instanceof Box) return v.d.get ? v.d.get.call(receiver) : child(t, v.d.value);
    const p = child(t, v);
    if (__DEV__ && p?.[$THIN]?.c) subKeys!.set(p[$THIN], key);
    if ((__OBSERVE__ && attrHooks !== null) || signalHook !== null) noteParent(p, t, key);
    (node as any).px = p;
    (node as any).pxv = v;
    return p;
  },
  has(_, key) {
    const t: Target = _[$S];
    if (t.c !== null) return CHAIN.has!(_, key);
    if (verdict !== null && affectsHooks !== null && getObserver() === null)
      affectsHooks._witness(t as any, key);
    if (key === $THIN || key === $PROXY || key === $TRACK) return true;
    if (t._fam !== null) pullFamily(t);
    if (!inDraft(t) && getObserver() !== null) {
      const h = (t.h ??= Object.create(null) as Record<PropertyKey, Signal<boolean>>);
      if (h[key] === undefined) {
        // Presence without the value (an accessor is not run for `in`).
        const node = t.n?.[key];
        const here = node !== undefined ? peek(node, t, 2) !== ABSENT : hasOwn.call(t.v, key);
        h[key] = slot(t, here, isEqual, key);
        if (t._fam !== null) t._fam.live.add(t as any);
      }
      return read(h[key]);
    }
    if (t.n?.[key] === undefined) return key in t.v;
    const v = valueOf(t, key, 2);
    return v !== ABSENT || (!hasOwn.call(t.v, key) && key in t.v);
  },
  ownKeys(_) {
    const t: Target = _[$S];
    if (t.c !== null) return CHAIN.ownKeys!(_);
    if (verdict !== null && affectsHooks !== null && getObserver() === null)
      affectsHooks._witness(t as any, undefined);
    if (t._fam !== null) pullFamily(t);
    track(t);
    return keysOf(t);
  },
  getOwnPropertyDescriptor(_, key) {
    const t: Target = _[$S];
    if (t.c !== null) return CHAIN.getOwnPropertyDescriptor!(_, key);
    if (verdict !== null && affectsHooks !== null && getObserver() === null)
      affectsHooks._witness(t as any, key);
    if (t.r && key === "length")
      return { value: valueOf(t, key), writable: true, enumerable: false, configurable: false };
    // An enumerator already holds the key set (`k`) this pass: it reads the
    // frame, no presence node (#3664). A descriptor read alone tracks
    // presence (R13).
    const v = holdsKeys(t) || BASE.has!(_, key) ? valueOf(t, key) : ABSENT;
    if (v === ABSENT) return undefined;
    if (v instanceof Box)
      return v.d.get || v.d.set
        ? { ...v.d, configurable: true }
        : { ...v.d, value: child(t, v.d.value), configurable: true };
    const d = Object.getOwnPropertyDescriptor(t.v, key);
    if (d && (d.get || d.set)) return ((d.configurable = true), d);
    return {
      value: child(t, v),
      writable: true,
      enumerable: d ? d.enumerable : true,
      configurable: true
    };
  },
  defineProperty(_, key, d) {
    const t: Target = _[$S];
    if (!inDraft(t)) return (__DEV__ && warnOutside(t, key, "defineProperty"), true);
    if (key === "__proto__") return true;
    // A plain data property is a write; anything else is boxed whole into
    // the slot (staged with the frame like any value).
    if (!d.get && !d.set && d.enumerable !== false && d.writable !== false)
      writeSlot(t, key, unwrapThin(d.value));
    else write(t, key, new Box(d.get || d.set ? d : { ...d, value: unwrapThin(d.value) }));
    return true;
  },
  set(_, key, value) {
    const t: Target = _[$S];
    if (!inDraft(t)) return (__DEV__ && !internalWrite && warnOutside(t, key, "set"), true);
    if (key === "__proto__") return true;
    // #4808: a nested write through a store still loading its first answer
    // is dropped, as a write to that store is (A25); the chain stays.
    if (t.c !== null && t.c[$THIN]._fam?.node?._statusFlags & STATUS_UNINITIALIZED)
      return (__DEV__ && devWriteThroughLoading(subKeys!.get(t)), true);
    if (t.s) return (rawThin(value), writeSlot(t, key, value), true);
    // #4845: a derive's draft write of another store's proxy chains the
    // key to it, as the return form does (CS-R3/CS-R5).
    if (
      t._fam !== null &&
      !userWrite &&
      isThin(value) &&
      value[$THIN]._fam !== t._fam &&
      !inDraft(value[$THIN])
    )
      return (writeSlot(t, key, chainSlot(t, valueOf(t, key), value)), true);
    const v = unwrapThin(value);
    // A derive's new child over a child carrying guesses: the truth lands
    // into it, so the guesses re-base over it (D-34, #4336).
    if (t._fam?.opt && !userWrite && guessed !== null && isWrappable(v)) {
      const pv = valueOf(t, key);
      let pt = isWrappable(pv) ? (t._fam.map.get(pv) as unknown as Target | undefined) : undefined;
      if (pt === undefined || pt.r !== Array.isArray(v) || !famGuessing(t._fam)) {
        // A keyed row: paired by key with the guessed row it answers
        // (#4329, store/optimistic.ts `pairRows`).
        pt = undefined;
        const kf = t._fam.key;
        const k = kf ? kf(v) : undefined;
        if (k !== undefined)
          for (const c of t._fam.live as unknown as Set<Target>)
            if (c !== t && c.r === Array.isArray(v) && hasGuess(c) && kf!(c.p) === k) {
              pt = c;
              break;
            }
      }
      if (pt !== undefined) {
        thinReconcile(pt.p, v, t._fam.key ?? null, 0);
        if (pv !== pt.v) writeSlot(t, key, pt.v);
        return true;
      }
    }
    writeSlot(t, key, v);
    return true;
  },
  deleteProperty(_, key) {
    const t: Target = _[$S];
    if (inDraft(t)) write(t, key, ABSENT);
    else if (__DEV__) warnOutside(t, key, "deleteProperty");
    return true;
  },
  getPrototypeOf: _ => protoNow(_[$S]),
  setPrototypeOf: () => false
};

/** A chained target's traps: a key with no own value reads the chained
 * store's proxy (its identity, its nodes: inner writes flow with no
 * re-derive, #2941); a switch of chain notifies through `cv`. */
const inner = (t: Target, fn: () => any): any => (inDraft(t) ? untrack(fn) : fn());
function chainTracked(t: Target): boolean {
  if (inDraft(t) || getObserver() === null) return false;
  read((t.cv ??= slot(t, 0, isEqual, $PROXY)));
  return true;
}
function chainHas(t: Target, key: PropertyKey): boolean {
  if (key === $THIN || key === $PROXY || key === $TRACK) return true;
  if (t._fam !== null) pullFamily(t);
  const tr = chainTracked(t);
  let node = t.n?.[key];
  if (node === undefined && tr) node = nodeOf(t, key);
  const v = node === undefined ? DELEGATE : tr ? read(node) : peek(node, t);
  return v === DELEGATE ? inner(t, () => key in t.c) : v !== ABSENT;
}
function chainGet(t: Target, key: PropertyKey, receiver: any): any {
  if (key === $THIN) return t;
  if (key === $PROXY) return receiver;
  if (key === $REFRESH) return t._fam?.node ?? undefined;
  if (t._fam !== null) pullFamily(t);
  const tr = chainTracked(t);
  if (key === $TRACK) return (track(t), inner(t, () => t.c[$TRACK]));
  let node = t.n?.[key];
  // A prototype member (an array method) is the chained store's.
  const it: Target = t.c[$THIN];
  if (node === undefined && !hasOwn.call(it.v, key) && it.n?.[key] === undefined && key in it.v)
    return t.c[key];
  if (node === undefined && tr) node = nodeOf(t, key);
  const v = node === undefined ? DELEGATE : tr ? read(node) : peek(node, t);
  if (v === DELEGATE) {
    const iv = inner(t, () => t.c[key]);
    return t._fam !== null && isThin(iv) && iv[$THIN]._fam !== t._fam ? subChain(t, key, iv) : iv;
  }
  return v === ABSENT ? undefined : child(t, v);
}
const CHAIN: ProxyHandler<any> = {
  get: (_, key, receiver) => chainGet(_[$S], key, receiver),
  has: (_, key) => chainHas(_[$S], key),
  ownKeys(_) {
    const t: Target = _[$S];
    if (t._fam !== null) pullFamily(t);
    if (chainTracked(t)) (track(t), Reflect.ownKeys(t.c));
    return keysOf(t);
  },
  getOwnPropertyDescriptor(_, key) {
    const t: Target = _[$S];
    if (t.r && key === "length")
      return { value: valueOf(t, key), writable: true, enumerable: false, configurable: false };
    if (!chainHas(t, key)) return undefined;
    return { value: chainGet(t, key, t.p), writable: true, enumerable: true, configurable: true };
  }
};
/** A chained target's child read through the chain is this family's own
 * proxy, chained to the inner child: a write through it stays in this store
 * (#2932, each level its own proxies). */
const subChains = new WeakMap<Target, Map<PropertyKey, Target>>();
const subKeys = __DEV__ ? new WeakMap<Target, PropertyKey>() : null;
function devWriteThroughLoading(key: PropertyKey | undefined): void {
  const name = String(key ?? "");
  reportDiagnostic(
    emitDiagnostic({
      code: "STORE_WRITE_THROUGH_LOADING",
      kind: "write",
      severity: "warn",
      message:
        `[STORE_WRITE_THROUGH_LOADING] A store setter wrote inside "${name}", which is another ` +
        `store still loading its first answer. The write was dropped: when that store loads, its ` +
        `answer is what shows, as for a write to a loading store itself. Write after it loads, or ` +
        `replace the whole value: \`setStore(s => { s.${name} = value })\`.`,
      nodeName: name,
      data: { operation: "set", property: name }
    })
  );
}
function subChain(t: Target, key: PropertyKey, iv: any): any {
  let m = subChains.get(t);
  if (m === undefined) subChains.set(t, (m = new Map()));
  const r = iv[$THIN].r;
  let e = m.get(key);
  if (e === undefined || e.r !== r) {
    const raw = r ? [] : {};
    thinWrap(raw, t._fam);
    e = t._fam!.map.get(raw) as unknown as Target;
    m.set(key, e);
    if (__DEV__) subKeys!.set(e, key);
  }
  chainTo(e, iv);
  return e.p;
}
/** A derived store seeded with another store reads it through live. */
export const thinChain = (proxy: any, next: any): void => chainTo(proxy[$THIN], next);
function chainTo(t: Target, next: any): void {
  if (t.c === next) return;
  const was = t.c;
  t.c = next;
  // Own values give way to the chain's (a guess or a pending write too).
  if (t.n !== null) for (const key of Reflect.ownKeys(t.n)) put(t, t.n[key as any], () => DELEGATE);
  if (was === null && t.k !== null) put(t, t.k, (x: number) => x + 1);
  if (t.cv !== null) put(t, t.cv, (x: number) => x + 1);
}
/** A family slot holding another store: a raw of this family's, chained
 * to it (#2864, #4845). */
function chainSlot(t: Target, pv: any, nv: any): any {
  let pt: Target | undefined = isWrappable(pv) ? (t._fam!.map.get(pv) as any) : undefined;
  if (pt === undefined || pt.r !== Array.isArray(nv)) {
    pv = Array.isArray(nv) ? [] : {};
    thinWrap(pv, t._fam);
    pt = t._fam!.map.get(pv) as any;
  }
  chainTo(pt!, nv);
  return pv;
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
  t.w = true; // its nodes hold the chain's values, not the raw's
  if (t.cv !== null) put(t, t.cv, (x: number) => x + 1);
}

function replace(t: Target, next: any): void {
  if (next === t.v && t.n === null) return;
  for (const key of keysOf(t)) if (!hasOwn.call(next, key)) write(t, key, ABSENT);
  for (const key of Reflect.ownKeys(next)) write(t, key, unwrapThin(next[key]));
}

const ASYNC_SETTER =
  "[ASYNC_STORE_SETTER] Store setter callback returned a Promise. A store setter is a synchronous transaction: " +
  "the draft closes when the callback returns, so writes after an `await` are lost. " +
  "Move the await into an action() and call the setter from there.";

function devGuardStoreSetterResult(result: any): void {
  if (result == null || (typeof result !== "object" && typeof result !== "function")) return;
  if (typeof result.then !== "function") return;
  emitDiagnostic({
    code: "ASYNC_STORE_SETTER",
    kind: "write",
    severity: "error",
    message: ASYNC_SETTER,
    ownerId: context?.id,
    ownerName: (context as any)?._name,
    data: { operation: "setStore" }
  });
  throw new Error(ASYNC_SETTER);
}

/** Dev: a store setter inside an owned scope (a memo body) is the
 * owned-scope write violation (store.ts `devGuardStoreSetterWrite`). */
function devGuardOwnedWrite(): void {
  if (
    context &&
    !(context._config & CONFIG_CHILDREN_FORBIDDEN) &&
    !disposalDepth &&
    !inRefCallback()
  ) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name,
      data: { operation: "setStore" }
    });
    throw new Error(ownedScopeWriteMessage(context));
  }
}

/** Dev: a write outside the setter is ignored; said once per target+key
 * (#4179, store.ts `warnWriteOutsideSetter`). */
const warnedOutside: WeakMap<Target, Set<PropertyKey>> | null = __DEV__ ? new WeakMap() : null;
function warnOutside(
  t: Target,
  key: PropertyKey,
  operation: "set" | "defineProperty" | "deleteProperty"
): void {
  let keys = warnedOutside!.get(t);
  if (keys === undefined) warnedOutside!.set(t, (keys = new Set()));
  if (keys.has(key)) return;
  keys.add(key);
  const name = String(key);
  const access =
    typeof key === "string" && /^[A-Za-z_$][\w$]*$/.test(key)
      ? `.${key}`
      : typeof key === "string" && /^\d+$/.test(key)
        ? `[${key}]`
        : `[${typeof key === "string" ? JSON.stringify(key) : name}]`;
  const hint =
    operation === "deleteProperty"
      ? `setStore(s => { delete s${access} })`
      : `setStore(s => { s${access} = value })`;
  reportDiagnostic(
    emitDiagnostic({
      code: "STORE_WRITE_OUTSIDE_SETTER",
      kind: "write",
      severity: "warn",
      message:
        `[STORE_WRITE_OUTSIDE_SETTER] ${
          operation === "deleteProperty" ? "Deleting" : "Writing"
        } store property "${name}" outside its setter was ignored. ` +
        `Stores are read-only outside the setter's draft: use \`${hint}\`.`,
      nodeName: name,
      data: { operation, property: name }
    })
  );
}

/** A setter's written keys per target and their prior values, for the
 * attribution engine's spread-copy census (`storeWrite`, observe only). */
let obsWrites: Map<Target, Map<PropertyKey, any>> | null = null;
function noteWrite(t: Target, key: PropertyKey, prev: any, v: any): void {
  const m = (obsWrites ??= new Map());
  let w = m.get(t);
  if (w === undefined) {
    m.set(t, (w = new Map()));
    // An array's old items (the census's moved-row check).
    if (t.r)
      (w as any).items = Array.from({ length: valueOf(t, "length") }, (_, i) => valueOf(t, i));
  }
  const u = (x: any) => (x === ABSENT ? undefined : x);
  const e = w.get(key);
  w.set(key, [e === undefined ? u(prev) : e[0], u(v)]);
}
function flushWrites(): void {
  const m = obsWrites;
  obsWrites = null;
  if (m === null || attrHooks === null) return;
  if (!toolsWrapped) wrapTools();
  for (const [t, w] of m) {
    const old: any = t.r ? [...(w as any).items] : {};
    const pb: any = t.r ? [] : {};
    for (const [k, [ov, nv]] of w) {
      old[k as any] = ov;
      pb[k as any] = nv;
    }
    attrHooks.storeWrite(t as any, old, pb, w.keys());
  }
}
export function thinSetter<T>(proxy: T, fn: (draft: T) => T | void, guard = true): void {
  if (writeHook !== null) writeHook(proxy as object);
  if (__DEV__ && guard) devGuardOwnedWrite();
  const prevUser = userWrite;
  userWrite = guard;
  const t0: Target = (proxy as any)[$THIN];
  scopes.push(scopeOf(t0));
  writing++;
  let result: any;
  try {
    result = fn(proxy);
    // The sync writes stand (they notified); a thenable is the async-setter
    // mistake, thrown before any adoption (store.ts `storeSetter`).
    if (__DEV__ && guard) devGuardStoreSetterResult(result);
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
    if (__OBSERVE__ && writing === 0 && obsWrites !== null) flushWrites();
  }
  const fw: any = heldHit;
  if (fw !== null && writing === 0) {
    heldHit = null;
    if (!(fw._flags & REACTIVE_DIRTY)) {
      fw._flags = (fw._flags & ~REACTIVE_CHECK) | REACTIVE_DIRTY;
      insertIntoHeap(fw, dirtyQueue);
      schedule();
    }
  }
}
let heldHit: Computed<any> | null = null;

export function createThinStore<T extends object>(
  value: T,
  shallow?: boolean,
  options?: { name?: string; loc?: string }
): [T, (fn: (draft: T) => T | void) => void] {
  const raw = unwrapThin(value);
  if (shallow) {
    if (Array.isArray(raw)) for (const v of raw) rawThin(v);
    else for (const k in raw) rawThin(raw[k]);
  }
  const proxy = wrap(raw);
  // Dependency edges (store/edges.ts): the root is named like a plain signal.
  if (signalHook !== null) signalHook(proxy[$THIN]);
  if (shallow) proxy[$THIN].s = true;
  if (__OBSERVE__) thinObserveStore(proxy, options);
  return [proxy, fn => thinSetter(proxy, fn)];
}
/** A shallow store's record is raw by contract (types.ts `markRawOne`); a
 * store placed in it stays a store. */
function rawThin(v: any): void {
  if (!isWrappable(v) || isThin(v)) return;
  if (__DEV__ && targets.has(v))
    throw new Error(
      "shallow store: an ingested record is already tracked as a deep store — one value cannot present both wrapped and raw"
    );
  markRaw(v);
}

/** Keyed merge of `next` into the store (inside a setter). */
export function thinReconcile(
  proxy: any,
  next: any,
  keyFn: ((v: any) => any) | null,
  root: 0 | 1 | 2 = 1 // nested | root (a different entity swaps) | user root (throws)
): void {
  reconcileTarget(proxy[$THIN], next, keyFn, root);
}
function reconcileTarget(
  t: Target,
  next: any,
  keyFn: ((v: any) => any) | null,
  root: 0 | 1 | 2
): void {
  const proxy = t.p;
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
  if (t.s && t._fam === null) {
    if (t.r) {
      const len = valueOf(t, "length");
      for (let i = 0; i < next.length; i++) (rawThin(next[i]), write(t, i, next[i]));
      for (let i = next.length; i < len; i++) write(t, i, ABSENT);
      write(t, "length", next.length);
    } else {
      for (const key of keysOf(t)) if (!hasOwn.call(next, key)) write(t, key, ABSENT);
      for (const key of Reflect.ownKeys(next)) (rawThin(next[key]), write(t, key, next[key]));
    }
    return;
  }
  const map: WeakMap<object, any> = (t._fam?.map as any) ?? targets;
  // Descend only where a proxy exists below: a subtree nobody read has no
  // identity or readers to keep, so the new value just takes the slot.
  let sent: Set<any> | undefined;
  const resent = (pv: any): boolean => {
    if (t.r) return (sent ??= new Set(next)).has(pv);
    for (const k in next) if (next[k] === pv) return true;
    return false;
  };
  // The draft's value of a key: the raw's while no write moved it.
  const cur = (key: PropertyKey): any => (!t.w && t.c === null ? seed(t, key) : valueOf(t, key));
  const merge = (pv: any, nv: any): any => {
    // The same raw re-sent over a row a write moved off it: back to the raw.
    if (pv === nv && isWrappable(nv)) {
      const pt = map.get(pv);
      if (pt?.w) (reconcileTarget(pt, nv, keyFn, 0), (pt.w = false));
      return nv;
    }
    // A store inside a derive's value: the slot chains to it (#2864).
    if (t._fam !== null && isThin(nv) && nv[$THIN]._fam !== t._fam) {
      return chainSlot(t, pv, nv);
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
    // A raw already wrapped, or re-sent at another slot, is its own row:
    // identity travels with the raw (#4001).
    if (pt === undefined || map.has(nv) || resent(pv)) return nv;
    if (keyFn !== null) {
      const pk = keyOf(pv);
      if (pk !== undefined && pk !== keyFn(nv)) return nv;
    }
    reconcileTarget(pt, nv, keyFn, 0);
    return pv;
  };
  // A row no write moved off its raw keys by the raw (no proxy read).
  const keyOf = (p: any): any => {
    if (!isWrappable(p)) return undefined;
    const pt = map.get(p);
    return keyFn!(pt !== undefined && (pt.w || pt.c !== null) ? pt.p : p);
  };
  if (t.r) {
    const len = cur("length");
    let byKey: Map<any, any> | null = null;
    for (let i = 0; i < next.length; i++) {
      const nv = next[i];
      let pv = i < len ? cur(i) : undefined;
      const nk = keyFn !== null && isWrappable(nv) ? keyFn(nv) : undefined;
      if (nk !== undefined && keyOf(pv) !== nk) {
        if (byKey === null) {
          byKey = new Map();
          for (let j = 0; j < len; j++) {
            const p = cur(j);
            const k = keyOf(p);
            if (k !== undefined && !byKey.has(k)) byKey.set(k, p);
          }
          // The truth answering a guessed row (a push the user made) takes
          // that row's identity: the row keeps its proxy and readers (D-34,
          // store/optimistic.ts `pairRows`).
          if (guessed !== null && t._fam?.opt && t.n !== null)
            for (const key of Reflect.ownKeys(t.n)) {
              const node = t.n[key as any];
              if (!(node._config & CONFIG_GUESS)) continue;
              const g = guessed(node);
              const k = keyOf(g);
              if (k !== undefined && !byKey.has(k)) byKey.set(k, g);
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
  // Keys `next` lacks go absent (`write` skips one already absent).
  if (t.c !== null) {
    for (const key of keysOf(t)) if (!hasOwn.call(next, key)) write(t, key, ABSENT);
  } else {
    for (const key of Reflect.ownKeys(t.v)) if (!hasOwn.call(next, key)) write(t, key, ABSENT);
    const n = t.n;
    if (n !== null && t.x)
      for (const key of Reflect.ownKeys(n))
        if (!hasOwn.call(t.v, key) && !hasOwn.call(next, key)) write(t, key, ABSENT);
  }
  for (const key of Reflect.ownKeys(next)) {
    const pv = cur(key);
    const nv = next[key];
    // A key `next` hides keeps its attribute (A29, #3706).
    if (!propertyIsEnumerable.call(next, key)) {
      if (!(pv instanceof Box && !pv.d.enumerable && Object.is(pv.d.value, nv)))
        write(
          t,
          key,
          new Box({ value: nv, writable: true, enumerable: false, configurable: true })
        );
    } else write(t, key, merge(pv === ABSENT ? undefined : pv, nv));
  }
  const np = protoOf(next);
  if (t.c === null && np !== protoNow(t)) (put(t, protoNode(t), () => np), (t.w = true));
}

/** A snapshot copy's property: a boxed or non-plain one keeps its attributes. */
function setProp(copy: any, raw: any, k: PropertyKey, v: any): void {
  let d = v instanceof Box ? v.d : Object.getOwnPropertyDescriptor(raw, k);
  if (d !== undefined && (d.get || d.set)) {
    if (v instanceof Box) return void Object.defineProperty(copy, k, d);
    d = undefined; // a data write replaced the raw accessor (#3949)
  }
  if (v instanceof Box) v = v.d.value;
  if (d === undefined || (d.enumerable && d.writable)) copy[k] = v;
  else if (typeof k === "symbol" && !d.enumerable) return;
  else Object.defineProperty(copy, k, { ...d, value: v, configurable: true });
}
/** Plain copy of the reader's frame; untouched subtrees keep source identity. */
export function thinSnapshot(
  value: any,
  seen = new Map<object, any>(),
  fam: StoreFamily | null = isThin(value) ? value[$THIN]._fam : null
): any {
  const raw = unwrapThin(value);
  if (raw === null || typeof raw !== "object") return raw;
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
      copy = t.r ? [] : Object.create(protoNow(t));
      seen.set(raw, copy);
      if (t.r) copy.length = valueOf(t, "length");
      for (const k of keys) if (k !== "length" || !t.r) setProp(copy, raw, k, valueOf(t, k));
    }
  };
  if (t.w) start(); // unwritten: every node holds the raw
  for (const k of keys) {
    if (t.r && k === "length") continue;
    const d = Object.getOwnPropertyDescriptor(copy ?? raw, k);
    if (d === undefined || d.get || d.set) continue;
    const v = d.value;
    const s = thinSnapshot(v, seen, fam);
    if (s !== v) (start(), Object.defineProperty(copy, k, { ...d, value: s }));
  }
  return copy ?? raw;
}

/** Tracking copy: subscribes to every reachable key set and value, and
 * returns snapshot()'s copy (its shape and identity). */
export function thinDeep(value: any): any {
  const walk = (v: any, seen: Set<any>) => {
    if (isThin(v) && !seen.has(v)) {
      seen.add(v);
      for (const k of Reflect.ownKeys(v)) walk(v[k], seen);
    }
  };
  walk(value, new Set());
  return thinSnapshot(value);
}

// Devtools `DEV.setSignal` on a thin slot node goes through the setter;
// any other node goes to the writer registered before (the deep store's).
// Chained at the first thin store, after every module registered.
let writerChained = false;
function chainDevWriter(): void {
  writerChained = true;
  const prev = devStoreSlotWriter();
  registerDevStoreSlotWriter((node, value) => {
    const host = (node as any)._host;
    const key = (node as any)._key;
    if (host && !("px" in host) && host.p && key !== $TRACK && host.n?.[key] === node)
      return thinSetter(host.p, (d: any) => void (d[key] = value));
    prev ? prev(node, value) : setSignal(node, value as any);
  });
}
