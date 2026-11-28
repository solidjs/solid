/**
 * The store engine: a signal per touched key.
 *
 * The raw object is the seed and the identity; it is never mutated. Every key
 * that is tracked or written gets one core signal, and that signal is the
 * key's whole state: committed value, staging, holds and lanes are core's.
 */
import { checkForeignRead } from "../core/copies.js";
import { forEachDependent } from "../core/async.js";
import {
  $REFRESH,
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_MANUAL_WRITE,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_LANE_DIRTY,
  CONFIG_NO_SNAPSHOT,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_ZOMBIE,
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
  ownedScope,
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
  registerDevStoreSlotWriter,
  registerGraph,
  reportDiagnostic,
  warnStrictReadUntracked
} from "../core/dev.js";
import { attrHooks, registerStoreTools } from "../core/attribution-hooks.js";
import { link, setSlotUnobserved } from "../core/graph.js";
import { getObserver, getOwner } from "../core/owner.js";
import { insertIntoHeap } from "../core/heap.js";
import {
  dirtyQueue,
  flushTransaction,
  GlobalQueue,
  holdNode,
  installStoreHooks,
  joinFuture,
  laneStageHook,
  list,
  queuePendingNode,
  observeFlightHook,
  passLane,
  question,
  resolveTx,
  schedule,
  txOf,
  staleReader
} from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import { storeOwners, type StoreFamily } from "./target.js";
import { thinParents } from "./thinParents.js";
import { signalHook } from "../core/identities.js";
import { affectsHooks } from "./hooks.js";
import {
  $PROXY,
  $RECORD,
  $TARGET,
  $TRACK,
  isRawValue,
  isWrappable,
  markRaw,
  writeOverride
} from "./types.js";

import { $THIN, installStoreKeys } from "./types.js";
export { $THIN };
/** The proxy shell's back-reference to its target (one shared handler). */
const $S = Symbol();
/** The key of a plain target's deep() node (`dv`). */
const $DEEP = Symbol();
setSlotUnobserved(release as any);
let staged: Set<any> | null = null;
// The commit seam (core `storeCommitHook`, once per flush): the nodes a
// staged write kept try again; one still uncommitted goes back in the set.
// A store build has a park hook too: core asks a derived store's family of
// a status that reached its derive by propagation (`_fam.st`).
installStoreHooks(
  () => {},
  () => {
    const s = staged;
    staged = null;
    if (s !== null) for (const n of s) release(n);
  }
);
/** A node whose last reader let go leaves its target when the raw already
 * says what it says (#3351): nothing is lost, the next read re-creates it
 * from the seed. A target with no node leaves its family's live index. A
 * written node, or one a frame still carries, stays. */
function release(node: any, settled?: boolean): void {
  if (node._subs !== null) return;
  // A staged write or a guess the node still carries: released at its
  // commit.
  if (
    node._pendingValue !== NOT_PENDING ||
    node._config & (CONFIG_OVERRIDE | CONFIG_HELD | CONFIG_GUESS)
  )
    return void (staged ??= new Set()).add(node);
  // One a lane carried may come back while anything is still out (a
  // revert's kept guess, #4336): released once everything settled (S7).
  if (node._x !== null && !settled) return void (laneCarried ??= new Set()).add(node);
  const t: Target = node._host;
  const key = node._key;
  if (key === $TRACK) {
    if (t.k !== node || (t.l && node._value !== t.v)) return;
    t.k = null;
  } else if (key === $DEEP) {
    if (t.dv !== node) return;
    t.dv = null;
  } else if (t.n?.[key] === node) {
    if (!Object.is(node._value, seed(t, key))) return;
    delete t.n![key];
    t.q!--;
  } else if (t.h?.[key] === node) {
    // A chained target's presence is the chain's: not released here.
    if (t.c !== null || node._value !== (valueOf(t, key) !== ABSENT)) return;
    delete t.h![key];
    t.q!--;
  } else return;
  // A count, not an enumeration: a wide map deleted key by key goes
  // dictionary-mode, and a `for…in` per release was quadratic (clear).
  if (t.q === 0) {
    // Emptied dictionaries are dropped (#5024): the target outlives its
    // readers while the app holds the raw.
    t.n = t.h = null;
    if (t._fam !== null && t.k === null) t._fam.live.delete(t as any);
  }
}
let laneCarried: Set<any> | null = null;
/** At a commit: release the lane-carried nodes nobody reads that no live
 * transaction or lane still lists (thinOptimistic.ts). A derive's family
 * keeps them: its re-run can bring a displaced guess back (#4336). */
export function releaseSettled(live: (n: any) => boolean): void {
  const s = laneCarried;
  if (s !== null) {
    laneCarried = null;
    for (const n of s)
      live(n) || n._host._fam?.node ? (laneCarried ??= new Set()).add(n) : release(n, true);
  }
}
const ABSENT: any = Symbol(__DEV__ ? "ABSENT" : 0);

interface Target {
  /** seed + identity */
  v: any;
  /** value nodes */
  n: Record<PropertyKey, Signal<any>> | null;
  /** presence nodes */
  h: Record<PropertyKey, Signal<boolean>> | null;
  /** structure version */
  k: Signal<any> | null;
  /** proxy */
  p: any;
  /** array? */
  r: boolean;
  /** derived-store family (projection), or null */
  _fam: StoreFamily | null;
  /** the family code reads these names */
  dk: null;
  /** a write took a key away: a node may hold ABSENT (keysOf filters) */
  gone: boolean;
  /** the raw's own properties are all plain data (enumerable, writable, no
   * accessor): snapshot copies by assignment (undefined: not asked yet) */
  pl: boolean | undefined;
  /** asked once: an array raw's non-index own keys (symbols, named), a
   * record raw's own keys */
  mk: PropertyKey[] | null;
  /** a plain store's deep() node: bumped by every write to this target */
  dv: Signal<number> | null;
  s: boolean;
  /** chained: the store a derive returned, read through live (#2941) */
  c: any;
  /** chain version: bumped when the chain switches */
  cv: Signal<number> | null;
  /** the proxy handler (swapped for the chain's) */
  hd: ProxyHandler<any> | null;
  /** written: a node may differ from the raw */
  w: boolean;
  /** the open setter whose draft reached this plain target */
  ws: number;
  /** the store this target was first reached from */
  rt: Target;
  /** a node exists for a key the raw lacks */
  x: boolean;
  /** how many value and presence nodes it holds */
  q: number;
  /** prototype node (a class member read, or a swap) */
  o: Signal<any> | null;
  /** an optimistic family's list: `k` holds its rows, one node (D-33) */
  l: boolean;
  /** the open setter's copy of the rows, written to `k` when it closes */
  da: any[] | null;
  /** a list guess written over a question in flight (thinOptimistic.ts) */
  over: boolean;
  lg: any;
  /** per-action key nodes of an optimistic record (D-33) */
  ks: Map<number, Signal<number>> | null;
  /** the first parent this target was reached through (reconcile's gate) */
  u: Target | null;
  /** this target or one below it (through `u`) ever had a node: reconcile
   * descends only here (#2902; sticky, as store.ts's STORE_DESC was) */
  d: boolean;
  /** the source object the last keyed reconcile merged in, while no write
   * since touched this target or one below it (cleared up `u`) */
  sv: any;
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
export function thinWrap(v: any, fam: StoreFamily | null = null, u: Target | null = null): any {
  const map: WeakMap<object, any> = fam?.map ?? targets;
  let t: Target | undefined = map.get(v);
  if (t === undefined) {
    // A store a plain store holds is that store: one identity everywhere
    // (CS-R2; a derived store's view of it is its own, `chainSlot`).
    if (isThin(v)) {
      // A proxy inside a written value: this family's own row is itself;
      // another store's is this family's chained view of it (CS-R3).
      const vf = v[$THIN]._fam;
      if (fam === null || vf === fam || u === null) return v;
      return (fam.map.get(chainSlot(u, v, false)) as any).p;
    }
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
      gone: false,
      pl: undefined,
      mk: null,
      dv: null,
      s: false,
      c: null,
      cv: null,
      hd: null,
      // Every field up front: one hidden class for every target.
      w: false,
      ws: 0,
      rt: null as any,
      x: false,
      q: 0,
      o: null,
      l: r && !!fam?.opt,
      da: null,
      ks: null,
      over: false,
      lg: null,
      u,
      d: false,
      sv: null
    };
    const shell: any = r ? [] : {};
    shell[$S] = t;
    t.rt = u === null ? t : u.rt;
    t.p = new Proxy(shell, BASE);
    map.set(v, t);
  }
  return t.p;
}
const wrap = thinWrap;
/** What a slot of `t` holds for `v`: a plain store's proxy as its raw
 * (the raw resolves to that one proxy again); a derived store's proxy in a
 * plain store stays the proxy. */
const held = (t: Target, v: any): any =>
  !isThin(v)
    ? v
    : t._fam === null
      ? v[$THIN]._fam === null
        ? v[$THIN].v
        : v
      : v[$THIN]._fam === t._fam
        ? v[$THIN].v
        : chainSlot(t, v);
/** Dev: each target's root (the first store it was reached from), the
 * holder the post-await read warning reports once per (store.ts `storeRoot`). */
const devRoot: WeakMap<Target, Target> | null = __DEV__ ? new WeakMap() : null;
/** A plain row the open setter reached is its draft's. */
function reach(t: Target, p: any): any {
  if (writing !== 0 && t._fam === null && t.ws === session) {
    const ct = p[$THIN];
    if (ct) ct.ws = session;
  }
  return p;
}
function child(t: Target, v: any): any {
  if (t.s) {
    // A shallow slot serves verbatim; a store placed in it is served
    // through the slot's chain to it (#2932: each level its own proxies).
    // A derived store's seed that holds a store is its view of it too (CS-R3).
    const ct: Target | undefined =
      t._fam === null || !isWrappable(v)
        ? undefined
        : (t._fam.map.get(
            isThin(v) && v[$THIN]._fam !== t._fam ? chainSlot(t, v, false) : v
          ) as any);
    return ct !== undefined && ct.c !== null ? ct.p : v;
  }
  if (!isWrappable(v) || isRawValue(v)) return v;
  const p = wrap(v, t._fam, t);
  reach(t, p);
  if (__DEV__) {
    const ct: Target = p[$THIN];
    if (ct !== t && !devRoot!.has(ct)) devRoot!.set(ct, devRoot!.get(t) ?? t);
  }
  return p;
}
/** The scopes with an open setter: a family, or a plain store's root. A
 * read of a store outside the open scopes is an ordinary read (a derive
 * reading another store tracks it). */
let scopes: object[] = [];
/** The innermost open setter. Plain stores share one raw-to-target map, so
 * a row another plain store reached first is in the draft by reach: read
 * through the setter's own draft. */
let session = 0,
  sessions = 0;
const scopeOf = (t: Target): object => t._fam ?? t.rt;
function inDraft(t: Target): boolean {
  if (writing !== 0) {
    const s = scopeOf(t);
    if (scopes[0] === s || scopes.includes(s) || (t._fam === null && t.ws === session)) return true;
    // A store with a setter is written from any store's open setter; an
    // optimistic setter's writes are its own store's guesses.
    if (userWrite && t._fam?.ow && !(scopes[scopes.length - 1] as StoreFamily).opt) return true;
  }
  return writeOverride && t._fam !== null;
}
export const unwrapThin = (v: any): any => (isThin(v) ? v[$THIN].v : v);

/** The reader's frame of a node: the draft reads its own staging; everyone
 * else reads through core (tracked or not: a pass joins a hold either way). */
/** The `affects()` walk reads the writer's view (the tick's guesses too). */
let writerView = false;
/** A row a list guess put where the truth has another (or none), with the
 * list's node and the row it replaced: reading the index is navigation;
 * what the setter reads of the row says whether its write is computed from
 * the guess (D-33). */
const placed = new WeakMap<object, [Signal<any>, any]>();
/** A hold whose staging the open user setter read from its draft. */
let draftRead: any = null;
function peek(node: Signal<any>, t: Target, mode = 0): any {
  if (writerView && guessed !== null && t._fam?.opt) return guessed(node);
  // An optimistic family's user draft composes on what the user sees.
  if (guessed !== null && t._fam?.opt && inDraft(t)) {
    if (userWrite) {
      // An action's read of a live guess is noted (#4788, D-33): core's
      // read does it outside a computation.
      // A presence read (mode 2) notes only a guess that changed presence (#4812).
      const v = guessed(node);
      if (mode && context === null) {
        const p = mode === 1 ? placed.get(t.v) : undefined;
        if (p !== undefined) {
          const o = isWrappable(p[1]) ? p[1][(node as any)._key] : undefined;
          if (isWrappable(v)) v !== o && placed.set(v, [p[0], o]);
          else if (!Object.is(v, o)) read(p[0]);
        }
        if (
          node._config & CONFIG_GUESS &&
          (mode === 1 || (v === ABSENT) !== (under!(node) === ABSENT))
        )
          read(node);
      }
      return v;
    }
    // The derive writes the truth: it composes on the truth beneath a guess.
    if (node._config & CONFIG_GUESS) return under!(node);
  }
  if (inDraft(t)) {
    if (node._pendingValue === NOT_PENDING) return node._value;
    // A user setter that reads a held write joins its hold at its exit (D-33).
    if (mode === 1 && userWrite && (node._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD)
      draftRead = txOf(node);
    return node._pendingValue;
  }
  // Dev: a read after an await is reported by the trap, once per store
  // (core's per-node report is skipped under untrack).
  return tracking || (__DEV__ && asyncTailFlights !== 0) ? untrack(() => read(node)) : read(node);
}
function seed(t: Target, key: PropertyKey): any {
  return t.c !== null ? DELEGATE : hasOwn.call(t.v, key) ? t.v[key] : ABSENT;
}
/** A chained target's node compares a read-through as the chain's value:
 * a guess the chain now says ends silently (A17, #3672). */
const chainEq =
  (t: Target, key: PropertyKey) =>
  (a: any, b: any): boolean => {
    const through = (v: any) => (v === DELEGATE ? untrack(() => innerValue(t, key)) : v);
    return Object.is(through(a), through(b));
  };
/** The chained store's raw value of `key` (ABSENT when not own). */
const innerValue = (t: Target, key: PropertyKey): any => inner(t, () => valueOf(t.c[$THIN], key));
function nodeOf(t: Target, key: PropertyKey, init: any = seed(t, key)): Signal<any> {
  const n = (t.n ??= Object.create(null) as Record<PropertyKey, Signal<any>>);
  let node = n[key];
  if (node === undefined) {
    // The store's one-literal slot node (px/pxv wrap cache pre-shaped).
    node = n[key] = slot(t, init, t.c !== null ? chainEq(t, key) : Object.is, key);
    t.q = (t.q || 0) + 1;
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
/** The attribution engine's store tools, registered at the first write it
 * attributes. */
function wrapTools(): void {
  toolsWrapped = true;
  registerStoreTools({
    pathOf: (t: any) => {
      let path = "";
      for (let p; (p = obsParent.get(t)) !== undefined; t = p[0]) path = "." + String(p[1]) + path;
      return "store" + path;
    },
    isShallow: (t: any) => t.s,
    deleted: () => null,
    rootOwner: (t: any) => storeOwners!.get(rootOf(t) as any),
    ownerKey: Symbol(),
    unwrapValue: (v: any) => (isThin(v) ? v[$THIN].v : v),
    targetsEqual: (a: any, b: any) => (isThin(a) || isThin(b)) && unwrapThin(a) === unwrapThin(b),
    isRawValue,
    isWrappable: (v: any) => isWrappable(v)
  });
}
function slot<V>(t: Target, v: V, eq: (a: V, b: V) => boolean, key: PropertyKey): Signal<V> {
  for (let p: Target | null = t; p !== null && !p.d; p = p.u) p.d = true;
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
/** The engine's half of `affects(store)`: store/affects.ts walks with it,
 * so a program with stores that declares no mark carries no walk. A Box
 * value is not wrappable, so `target` drops it. */
GlobalQueue._storeEngine = {
  node: (t: Target, key: PropertyKey) => (t.l && L!.ix(key) !== -2 ? keyNode(t) : nodeOf(t, key)),
  target: (v: any, fam: StoreFamily | null): Target | undefined =>
    isThin(v) ? v[$THIN] : isWrappable(v) ? ((fam?.map as any) ?? targets).get(v) : undefined,
  keys: keysOf,
  value: valueOf,
  sub: (t: Target) => subChains.get(t)?.values() ?? [],
  view: (on: boolean) => void (writerView = on)
};
/** The logical value of `key` in the reader's frame (ABSENT when not own). */
function valueOf(t: Target, key: PropertyKey, mode = 0): any {
  if (t.l) {
    const i = L!.ix(key);
    if (i !== -2) return L!.value(t, i, mode);
  }
  const node = t.n?.[key];
  const v = node !== undefined ? peek(node, t, mode) : seed(t, key);
  return v === DELEGATE ? innerValue(t, key) : v;
}
function keysOf(t: Target): (string | symbol)[] {
  const n = t.n;
  if (t.r) {
    // Unwritten, no node off the raw: the raw's keys are the keys.
    if (!t.w && !t.x && t.c === null && t.k === null) return ownOf(t.v);
    const len = valueOf(t, "length");
    const keys: string[] = [];
    for (let i = 0; i < len; i++) if (valueOf(t, i) !== ABSENT) keys.push("" + i);
    keys.push("length");
    // Non-index metadata (symbols, named keys) of the array.
    const meta = (k: PropertyKey) =>
      k !== "length" && (typeof k === "symbol" || "" + (+k >>> 0) !== k);
    for (const k of (t.mk ??= Reflect.ownKeys(t.v).filter(meta)))
      if (valueOf(t, k) !== ABSENT) keys.push(k as any);
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
  const keys = ownOf(t.v);
  if (n === null || !(t.gone || t.x)) return keys;
  const out = t.gone
    ? keys.filter(key => n[key] === undefined || peek(n[key], t, 2) !== ABSENT)
    : keys;
  if (t.x)
    for (const key of Reflect.ownKeys(n))
      if (!hasOwn.call(t.v, key) && peek(n[key], t, 2) !== ABSENT) out.push(key);
  return out;
}
/** A chained list's rows are the chain's while nothing of its own covers them. */
const CHAINED: any[] = [];
/** An optimistic family's lists (thinList.ts; thinOptimistic.ts installs
 * it, so a bundle without optimistic stores carries none of it). */
let L: ThinList | null = null;
export interface ThinList {
  ix(key: PropertyKey): number;
  eq(t: Target): (a: any[], b: any[]) => boolean;
  unchain(t: Target, keys: PropertyKey[], own: (key: PropertyKey) => any): void;
  root(t: Target): void;
  made(t: Target, byKey: Map<any, any>, keyOf: (row: any) => any): Set<any> | null;
  hold(t: Target): any;
  value(t: Target, i: number, mode: number): any;
  get(t: Target, i: number, tracked: boolean): any;
  has(t: Target, i: number, tracked: boolean): boolean;
  write(t: Target, i: number, v: any): void;
  mark(): number;
  close(from: number): void;
  screen(t: Target): any[] | null;
}
export const installThinList = (l: ThinList): void => void (L = l);
function keyNode(t: Target): Signal<any> {
  if (t.k === null) {
    t.k = t.l
      ? slot(t, t.c !== null ? CHAINED : t.v, L!.eq(t), $TRACK)
      : slot(t, 0, isEqual, $TRACK);
    if (t._fam !== null) t._fam.live.add(t as any);
  }
  return t.k!;
}
/** An index (>= 0), "length" (-1), or neither (-2). */
function track(t: Target): void {
  if (!inDraft(t) && getObserver() !== null) {
    read(keyNode(t));
    if (t.ks)
      for (const [q, o] of t.ks)
        o._config & (CONFIG_GUESS | CONFIG_OVERRIDE) || q === question ? read(o) : t.ks.delete(q);
  }
}
/** One node write: core stages it. A derive's own write is its derive's
 * (held with it, or a lane's work) — `holdWithDerive`, as in store.ts. */
function put(t: Target, node: Signal<any>, v: any): void {
  for (let p: Target | null = t; p !== null && p.sv !== null; p = p.u) p.sv = null;
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
    if (t.dv !== null && node !== t.dv) setSignal(t.dv, (x: number) => x + 1);
    // The derive's write is a derivation; a user setter's a proposal.
    if (t._fam !== null)
      userWrite
        ? (node._config |= CONFIG_MANUAL_WRITE)
        : ((node._config &= ~CONFIG_MANUAL_WRITE), holdWithDerive(t, node));
    if (
      holdIn !== null &&
      node._pendingValue !== NOT_PENDING &&
      !(node._config & (CONFIG_HELD | CONFIG_OVERRIDE))
    )
      holdNode(node, holdIn);
    // A continuation's write held with the derive: its readers re-run in
    // the hold's flush, staged with it (F-10; store.ts `notifyContainer`).
    if (!userWrite && !t._fam?.opt && flushTransaction === null && node._config & CONFIG_HELD)
      joinFuture(txOf(node));
  }
}
/** The hold a landing's writes into a guess-made row wait in. */
let holdIn: any = null;
// A plain store list's reconcile pass bumps its structure node once, at the
// end, not once per slot it writes (`reconcileTarget`).
let bumpFor: Target | null = null;
let bumped = false;
// `cur`: the caller's draft read of the key (`curOf`), on a plain store.
function write(t: Target, key: PropertyKey, v: any, cur: any = write): void {
  // A user's write on a view of another store: remembered for the
  // derive's next answer; a list becomes the view's own.
  if (userWrite && t.c !== null && t._fam !== null && !t._fam.opt)
    t.r ? privatize(t) : overlays(t._fam).has(t) || overlays(t._fam).set(t, null);
  if (t.l) {
    const i = L!.ix(key);
    if (i !== -2) return L!.write(t, i, v);
  }
  // No write has moved this target off its raw: every node holds the seed.
  const n0 = t.n?.[key];
  if ((!t.w || n0 === undefined) && Object.is(seed(t, key), v)) return;
  if (v === ABSENT) t.gone = true;
  const node = n0 ?? nodeOf(t, key);
  let prev = cur !== write ? cur : peek(node, t);
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
  if (Object.is(prev, v) && (userWrite || !(node._config & CONFIG_GUESS))) {
    // A user write another action's guess already made is a read of that
    // guess: the setter depends on it landing (D-33).
    if (userWrite && guessed !== null && node._config & CONFIG_GUESS && context === null)
      read(node);
    return;
  }
  if (__DEV__ && DEV.hooks.onStoreNodeUpdate && !(t.r && key === "length"))
    DEV.hooks.onStoreNodeUpdate(
      t.p,
      key,
      v === ABSENT ? undefined : v,
      prev === ABSENT ? undefined : prev
    );
  if (__OBSERVE__ && attrHooks !== null && userWrite) noteWrite(t, key, prev, v);
  // A function value is set as itself, not run as an updater.
  put(t, node, typeof v === "function" ? () => v : v);
  t.w = true;
  const h = t.h?.[key];
  if (h !== undefined) put(t, h, v !== ABSENT);
  // Structure: membership for records; position is content for arrays.
  if (t.k !== null && !t.l && (t.r ? key !== "length" : prev === ABSENT || v === ABSENT)) {
    if (bumpFor === t) return void (bumped = true);
    // A key a guess adds to or takes from a record is that key's slot (point
    // of write): the key node another action's guess carries is not a slot
    // the two share (D-33). This action's bump goes to a key node of its
    // own, which the readers read beside it.
    let k = t.k;
    if (
      userWrite &&
      guess !== null &&
      !t.r &&
      t._fam?.opt &&
      k._config & CONFIG_GUESS &&
      k._x!._q !== question
    ) {
      const ks = (t.ks ??= new Map());
      let o = ks.get(question);
      if (o === undefined) {
        ks.set(question, (o = slot(t, 0, isEqual, $TRACK)));
        forEachDependent(k as any, sub => link(o!, sub));
      }
      k = o;
    }
    put(t, k, (x: number) => x + 1);
  }
}

// ---------------------------------------------------------------------------
// derived stores: ported from store.ts as-is (they speak core nodes only)

export function linkedTo(c: Computed<any>, n: Signal<any>): boolean {
  for (let s = n._subs; s !== null; s = s._nextSub) if (s._sub === c) return true;
  return false;
}

/** Does `n` read `c`, through any chain of computations? Only a chain of
 * nodes above `c` can reach it, so the walk stops at `c`'s height (a signal
 * has no height and ends it too). */
function feeds(n: Computed<any>, c: Computed<any>): boolean {
  for (let l = n._deps; l; l = l._nextDep) {
    const d: any = l._dep;
    if (d === c || (d._height > c._height && feeds(d, c))) return true;
  }
  return false;
}

/** store.ts `pullFamily`: bring the derive up to date before serving. */
/** The optimistic engine's judgement (thinOptimistic.ts): the family's
 * guesses stand in for its flight (A17). */
let stands: (t: Target) => boolean | 2 | 3 = () => false;
/** A pass in a frame's hold served a list guess's values like lane work
 * (#4561): its reads of guessed leaves this pass are the guess. */
let serving: unknown = null;
let standing: unknown = null;
export function installThinStands(fn: typeof stands): void {
  stands = fn;
}
function pullFamily(t: Target): void {
  const fw = t._fam!.node;
  if (fw === null || inDraft(t)) return;
  // A reader the derive itself reads through (its row handed back into its
  // own source, #4970 / #4972) is the derive's input, not its reader: it
  // reads the leaves as the derive last wrote them, like any signal. Pulling
  // or linking the derive from it would be a cycle.
  const c: any = context;
  if (c?._subs && feeds(fw, c)) return;
  if (fw._statusFlags & (STATUS_PENDING | STATUS_ERROR) || fw._config & CONFIG_STAGED_ERROR) {
    // Guesses that stand in for the flight (A17) are the display: a reader
    // is served the leaves and does not suspend on the derive.
    if (verdict === null && fw._statusFlags & STATUS_PENDING) {
      const st = stands(t);
      if (st) return void (st === 2 ? (serving = context) : st === 3 && (standing = context));
    }
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
    const lane = passLane;
    list(node, lane);
    node._config |= CONFIG_OVERRIDE;
    // A leaf's notified readers re-derive as the lane's work, as `laneDirty` marks them.
    if (node !== t.k)
      for (let s = node._subs; s !== null; s = s._nextSub) {
        const c = s._sub;
        const tx = c._x?._transaction;
        if (
          tx?._lane
            ? tx === lane ||
              (tx._links !== null && tx._links === lane._links) ||
              c._flags & REACTIVE_ZOMBIE
            : (c as any)._type
        )
          c._flags |= REACTIVE_LANE_DIRTY;
      }
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
  if (!stageRow(fam, ov, nv, node)) return;
  // The slot itself is unchanged: no longer held.
  node._pendingValue = NOT_PENDING;
  node._config &= ~CONFIG_HELD;
}
/** One target over the old raw, the new raw's differing leaves staged on it
 * under `node`'s hold. Another store's row is not this store's to stage on:
 * the write stays in the view (CS-R4). */
function stageRow(fam: StoreFamily, ov: any, nv: any, node: Signal<any>): boolean {
  const ct: Target = wrap(ov, fam)[$THIN];
  if (ct._fam !== fam) return false;
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
  ct.w = ct.gone = true;
  return true;
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
const arraySlice = Array.prototype.slice;
/** A whole-list copy (`mapArray`'s `slice(0)`) reads each slot once: the
 * spec's `slice` asks presence (`has`) first, a second read per slot. */
function thinSlice(this: any, s?: number, e?: number): any[] {
  if (s || e !== undefined) return arraySlice.call(this, s, e);
  const t: Target = this[$THIN],
    n = this.length,
    c: any[] = new Array(n),
    // A plain list: a slot with a node is the get trap's read, without the
    // trap (its other arms are a family's, a draft's, or an observer-less
    // read's witness and dev checks).
    tracked = tracking && context !== null,
    lean =
      t._fam === null &&
      t.c === null &&
      (!tracked || standing === null) &&
      (getObserver() !== null ||
        ((verdict === null || affectsHooks === null) &&
          !(__DEV__ && (asyncTailFlights !== 0 || (strictRead && strictReadActive()))))) &&
      !inDraft(t);
  if (__DEV__ && lean && getObserver() === null) checkForeignRead();
  for (let i = 0, v, node: any; i < n; i++) {
    if (lean && (node = t.n?.[i]) !== undefined) {
      v = tracked ? read(node) : peek(node, t, 1);
      if (v === null || typeof v !== "object") {
        if (v !== ABSENT) {
          c[i] = v;
          continue;
        }
      } else if (node.pxv === v) {
        c[i] = node.px;
        continue;
      } else if (!(v instanceof Box)) {
        const p = child(t, v);
        if ((__OBSERVE__ && attrHooks !== null) || signalHook !== null) noteParent(p, t, i);
        c[i] = node.px = p;
        node.pxv = v;
        continue;
      }
    }
    if ((v = this[i]) !== undefined || i in this) c[i] = v;
  }
  return c;
}
function frameRead(t: Target, node: Signal<any>, tracked: boolean): any {
  let v: any;
  // A pass a refresh's re-ask holds while guesses stand in (D-34 ¶3, A17)
  // sees the screen plus the guesses: a leaf another write holds is its
  // committed value, read as a stale reader of that hold (A15, #4887).
  if (
    standing !== null &&
    standing === context &&
    tracked &&
    (node._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD
  )
    (link(node, context as any), staleReader(context as any, txOf(node)), (v = node._value));
  else v = tracked ? read(node) : peek(node, t, 1);
  if (serving !== null && serving === context && node._config & CONFIG_GUESS) v = guessed!(node);
  return v;
}
/** `Reflect.ownKeys` of a plain raw, several times faster on a fast-mode
 * object (same order: names, then symbols). */
const ownOf = (o: object): (string | symbol)[] => {
  const k: (string | symbol)[] = Object.getOwnPropertyNames(o),
    s = Object.getOwnPropertySymbols(o);
  return s.length ? k.concat(s) : k;
};
const NONE = Object.create(null);
/** A record's prototype in the reader's frame: a node once a reader of a
 * class member tracks it or a reconcile swaps it (A29, #3706). */
const protoNode = (t: Target): Signal<any> =>
  (t.o ??= slot(t, protoOf(t.v), Object.is, "[[Prototype]]"));
const protoNow = (t: Target): any => (t.o ? peek(t.o, t) : protoOf(t.v));
/** The record's keys as the `ownKeys` trap answers them; a merge or omit
 * view calls it directly (types.ts `storeKeys`): the Proxy's invariant
 * checks cost twice the trap. */
function ownKeysOf(t: Target): (string | symbol)[] {
  if (t.c !== null) return CHAIN.ownKeys!({ [$S]: t } as any) as any;
  if (verdict !== null && affectsHooks !== null && getObserver() === null)
    affectsHooks._witness(t as any, undefined);
  if (t._fam !== null) pullFamily(t);
  track(t);
  return keysOf(t);
}
installStoreKeys(ownKeysOf);
const BASE: ProxyHandler<any> = {
  get(_, key, receiver) {
    const t: Target = _[$S];
    if (__DEV__ && getObserver() === null) checkForeignRead();
    // A marked view is witnessed where it is read, not at its source.
    if (verdict !== null && affectsHooks !== null && getObserver() === null)
      affectsHooks._witness(t as any, typeof key === "symbol" ? undefined : key);
    if (t.c !== null) return CHAIN.get!(_, key, receiver);
    // Brands are symbols: a string key skips their checks.
    const sym = typeof key === "symbol";
    if (sym) {
      if (key === $THIN) return t;
      if (key === $PROXY) return receiver;
      // Brands a store is not: no node (a merge/omit asks for its record).
      if (key === $TARGET || key === $RECORD) return undefined;
      if (key === $REFRESH) return t._fam?.node ?? undefined;
    }
    if (t._fam !== null) pullFamily(t);
    if (sym && key === $TRACK) return (track(t), undefined);
    const tracked = tracking && context !== null && !inDraft(t);
    let node = t.n?.[key];
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
    if (t.l && !sym) {
      const i = L!.ix(key);
      if (i !== -2) return L!.get(t, i, tracked);
    }
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
        return typeof v === "function" ? (v === arraySlice ? thinSlice : v) : child(t, v);
      }
      if (!tracked) {
        if (!own) return undefined;
        const p = child(t, t.v[key]);
        if ((__OBSERVE__ && attrHooks !== null) || signalHook !== null) noteParent(p, t, key);
        return p;
      }
      // An own accessor seeds its node as its descriptor, so the tracked
      // reader holds a node a data write replaces (#3949).
      node = nodeOf(
        t,
        key,
        own && lookupGetter.call(t.v, key) !== undefined
          ? new Box(Object.getOwnPropertyDescriptor(t.v, key)!)
          : seed(t, key)
      );
    }
    if ((node._config & (CONFIG_HELD | CONFIG_GUESS)) === CONFIG_HELD && t._fam !== null)
      pairLate(t, node);
    const v = frameRead(t, node, tracked);
    if (v === null || typeof v !== "object")
      // A removed own key reads what the prototype says (#4674 ruling).
      return v !== ABSENT
        ? v
        : polluting(t, key)
          ? undefined
          : Reflect.get(protoOf(t.v) ?? {}, key, receiver);
    if ((node as any).pxv === v) return reach(t, (node as any).px);
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
    if (t.l) {
      const i = L!.ix(key);
      if (i !== -2) return L!.has(t, i, !inDraft(t) && getObserver() !== null);
    }
    if (!inDraft(t) && getObserver() !== null) {
      const h = (t.h ??= Object.create(null) as Record<PropertyKey, Signal<boolean>>);
      if (h[key] === undefined) {
        // Presence without the value (an accessor is not run for `in`).
        const node = t.n?.[key];
        // A staged value: presence mirrors it, committed and staged in the
        // same flush or hold, so a pass reads one frame for both (#4887).
        const staged =
          node !== undefined &&
          !(node._config & CONFIG_OVERRIDE) &&
          node._pendingValue !== NOT_PENDING;
        const here = staged
          ? node._value !== ABSENT
          : node !== undefined
            ? peek(node, t, 2) !== ABSENT
            : hasOwn.call(t.v, key);
        const p = (h[key] = slot(t, here, isEqual, key));
        if (staged && (node._pendingValue !== ABSENT) !== here) {
          p._pendingValue = !here;
          const tx = node._x?._transaction;
          if (tx) (list(p, tx), (p._config |= node._config & CONFIG_HELD));
          else queuePendingNode(p);
        }
        t.q = (t.q || 0) + 1;
        if (t._fam !== null) t._fam.live.add(t as any);
      }
      return read(h[key]);
    }
    if (t.n?.[key] === undefined) return key in t.v;
    const v = valueOf(t, key, 2);
    return v !== ABSENT || (!hasOwn.call(t.v, key) && key in t.v);
  },
  ownKeys: _ => ownKeysOf(_[$S]),
  getOwnPropertyDescriptor(_, key) {
    const t: Target = _[$S];
    if (t.c !== null) return CHAIN.getOwnPropertyDescriptor!(_, key);
    if (verdict !== null && affectsHooks !== null && getObserver() === null)
      affectsHooks._witness(t as any, key);
    if (t.r && key === "length")
      return {
        value: valueOf(t, key),
        writable: true,
        enumerable: false,
        configurable: !Array.isArray(_)
      };
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
      writeSlot(t, key, held(t, d.value));
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
    // The chain's own child put back at its key is the value the chain
    // shows there (#3672: a guess equal to the truth).
    const v =
      t.c !== null && isThin(value) && unwrapThin(value) === valueOf(t.c[$THIN], key)
        ? value[$THIN].v
        : held(t, value);
    // A derive's new child over a child carrying guesses: the truth lands
    // into it, so the guesses re-base over it (D-34, #4336).
    if (t._fam?.opt && !userWrite && guessed !== null && isWrappable(v)) {
      const pv = valueOf(t, key);
      let pt = isWrappable(pv) ? (t._fam.map.get(pv) as unknown as Target | undefined) : undefined;
      const kf = t._fam.key;
      const k = kf ? kf(v) : undefined;
      if (
        pt === undefined ||
        pt.r !== Array.isArray(v) ||
        !famGuessing(t._fam) ||
        (t.l && k !== undefined && keyAt(kf!, pt) !== k)
      ) {
        // A keyed row: paired by key with the guessed row it answers
        // (#4329, store/optimistic.ts `pairRows`).
        pt = undefined;
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
      // A row another store's guess lent as it is (a chain to that store's
      // proxy, not a copy) keeps it when the landing returns its key (Q-D):
      // the lent row takes the server object as its truth, so a guess of
      // that store's still out on the row shows until its action ends
      // (F-11, #4902).
      if (k !== undefined && t.l && carries(t.k))
        for (const g of L!.screen(t)!) {
          const c = isWrappable(g) ? (t._fam.map.get(g) as any)?.c : null;
          if (c && kf!(c) === k)
            return (thinReconcile(c, v, kf!, 0), writeSlot(t, key, chainSlot(t, c)), true);
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
/** A read through the chain. A user's draft composes on what the user
 * sees: the chain's own guesses too (the writer's view, #3672 shadow). */
const inner = (t: Target, fn: () => any): any => {
  if (!inDraft(t)) return fn();
  const was = writerView;
  writerView ||= userWrite;
  try {
    return untrack(fn);
  } finally {
    writerView = was;
  }
};
function chainTracked(t: Target): boolean {
  if (inDraft(t) || getObserver() === null) return false;
  read((t.cv ??= slot(t, 0, isEqual, $PROXY)));
  return true;
}
function chainHas(t: Target, key: PropertyKey): boolean {
  if (key === $THIN || key === $PROXY || key === $TRACK) return true;
  if (t._fam !== null) pullFamily(t);
  const tr = chainTracked(t);
  if (t.l) {
    const i = L!.ix(key);
    if (i !== -2) return L!.has(t, i, tr);
  }
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
  if (t.l) {
    const i = L!.ix(key);
    if (i !== -2) return L!.get(t, i, tr);
  }
  let node = t.n?.[key];
  // A prototype member (an array method) is the chained store's.
  const it: Target = t.c[$THIN];
  if (node === undefined && !hasOwn.call(it.v, key) && it.n?.[key] === undefined && key in it.v)
    return t.c[key];
  if (node === undefined && tr) node = nodeOf(t, key);
  const v = node === undefined ? DELEGATE : tr ? read(node) : peek(node, t);
  // A guess over the chain: its reader also hears the chain, so a guess
  // that ends silently (equal through the chain, A17) leaves it listening.
  if (tr && v !== DELEGATE && node!._config & CONFIG_GUESS) inner(t, () => t.c[key]);
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
const rowChains = new WeakMap<Target, WeakMap<object, Target>>();
/** The raws a chain reads through: no data of their own (an echo compares
 * them by identity, thinOptimistic.ts). */
const chainRaws = new WeakSet<object>();
export const chainedRaw = (v: any): boolean => v === DELEGATE || chainRaws.has(v);
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
  // A list's row is the source row's view wherever it sits: identity
  // follows the row (CS-R2), so a reorder moves it. A record's child is
  // the key's.
  let rows: WeakMap<object, Target> | undefined;
  if (t.r && (rows = rowChains.get(t)) === undefined) rowChains.set(t, (rows = new WeakMap()));
  let e = rows !== undefined ? rows.get(iv) : m.get(key);
  if (e === undefined || e.r !== r) {
    const raw = r ? [] : {};
    chainRaws.add(raw);
    thinWrap(raw, t._fam, t);
    e = t._fam!.map.get(raw) as unknown as Target;
    if (rows !== undefined) rows.set(iv, e);
    if (__DEV__) subKeys!.set(e, key);
  }
  if (m.get(key) !== e) m.set(key, e);
  // A list a user's write made a private copy stays one (`privatize`).
  if (e.c !== null || !e.w) chainTo(e, iv);
  return e.p;
}
/** A derived store seeded with another store reads it through live. */
export const thinChain = (proxy: any, next: any): void => chainTo(proxy[$THIN], next);
function chainTo(t: Target, next: any): void {
  if (t.c === next) return;
  const was = t.c;
  t.c = next;
  giveWay(t, was === null);
}
/** Own values give way to the chain's (a guess or a pending write too). */
function giveWay(t: Target, keys: boolean): void {
  if (t.n !== null) for (const key of Reflect.ownKeys(t.n)) put(t, t.n[key as any], () => DELEGATE);
  if (t.l ? t.k !== null : keys && t.k !== null)
    put(t, t.k!, t.l ? () => CHAINED : (x: number) => x + 1);
  if (t.cv !== null) put(t, t.cv, (x: number) => x + 1);
}
/** A user's writes on a derived store's view of another store, by target:
 * the chain a list left to take them (`privatize`), else null. */
const overlays = (fam: any): Map<Target, any> => (fam.ov ??= new Map());
/** The derive answered with the store again: the answer replaces what a
 * user wrote on its view, under `e` (CS-R4). */
function answered(e: Target): void {
  const ov: Map<Target, any> | undefined = (e._fam as any).ov;
  if (ov === undefined || userWrite) return;
  for (const [o, was] of ov) {
    let p: Target | null = o;
    while (p !== null && p !== e) p = p.u;
    if (p === null) continue;
    ov.delete(o);
    if (o.c === null) was !== null && chainTo(o, was);
    else giveWay(o, true);
  }
}
/** A user's write to a list read through a chain: the list is the view's
 * own from here (its rows still the source rows' views), so the source's
 * later inserts and removals leave no hole in it. */
function privatize(t: Target): void {
  const it = t.c[$THIN] as Target;
  overlays(t._fam).set(t, t.c);
  unchain(t, key => {
    const iv = valueOf(it, key);
    return isWrappable(iv) && !it.s && !isRawValue(iv)
      ? unwrapThin(subChain(t, key, child(it, iv)))
      : iv;
  });
}
/** A family slot holding another store: a raw of this family's, chained
 * to it (#2864, #4845). */
function chainSlot(t: Target, nv: any, write = true): any {
  // One raw per chained store in a family: two slots holding one store
  // are one row (an alias stays an alias).
  const m: WeakMap<object, any> = ((t._fam as any).cm ??= new WeakMap());
  let raw = m.get(nv);
  if (raw === undefined) {
    m.set(nv, (raw = Array.isArray(nv) ? [] : {}));
    chainRaws.add(raw);
    thinWrap(raw, t._fam, t);
    chainTo(t._fam!.map.get(raw) as any, nv);
  } else if (write) {
    // Written again: the store's view anew (a private list re-chains).
    const e: Target = t._fam!.map.get(raw) as any;
    chainTo(e, nv);
    answered(e);
  }
  return raw;
}
/** Leave the chain: every key takes the value it showed as its own. */
function unchain(
  t: Target,
  own: (key: PropertyKey) => any = key => valueOf(t.c[$THIN], key)
): void {
  const it = t.c[$THIN] as Target;
  const fix = (node: Signal<any>, key: PropertyKey) => {
    if (node._value === DELEGATE) node._value = own(key);
    if (node._pendingValue === DELEGATE) node._pendingValue = own(key);
  };
  if (t.n !== null) for (const key of Reflect.ownKeys(t.n)) fix(t.n[key as any], key);
  // A list's rows are its arrangement's, not nodes.
  const row = (key: PropertyKey) => t.l && L!.ix(key) !== -2;
  for (const key of keysOf(it)) if (t.n?.[key] === undefined && !row(key)) nodeOf(t, key, own(key));
  // A seed key the chain lacks reads absent too.
  for (const key of ownOf(t.v))
    if (t.n?.[key as any] === undefined && !row(key)) nodeOf(t, key, ABSENT);
  if (t.l) L!.unchain(t, keysOf(it), own);
  t.c = null;
  t.w = t.gone = true; // its nodes hold the chain's values, not the raw's
  if (t.cv !== null) put(t, t.cv, (x: number) => x + 1);
}

function replace(t: Target, next: any): void {
  if (next === t.v && t.n === null && t.k === null) return;
  for (const key of keysOf(t)) if (!hasOwn.call(next, key)) write(t, key, ABSENT);
  for (const key of ownOf(next)) write(t, key, t.s ? next[key] : held(t, next[key]));
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
  const owned = ownedScope();
  if (owned) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE,
      ownerId: owned.id,
      ownerName: (owned as any)._name,
      data: { operation: "setStore" }
    });
    throw new Error(ownedScopeWriteMessage(owned));
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
  const open = L === null ? 0 : L.mark();
  const t0: Target = (proxy as any)[$THIN];
  scopes.push(scopeOf(t0));
  writing++;
  const ps = session,
    pw = t0.ws;
  t0.ws = session = ++sessions;
  let result: any;
  try {
    result = fn(proxy);
    // The sync writes stand (they notified); a thenable is the async-setter
    // mistake, thrown before any adoption (store.ts `storeSetter`).
    if (__DEV__ && guard) devGuardStoreSetterResult(result);
    if (result !== undefined && result !== proxy && isWrappable(result)) {
      const t: Target = (proxy as any)[$THIN];
      // A user's returned value is a shallow diff on every store: the
      // keyed diff is the derive's. On an optimistic store it is the guess,
      // one write per key or index that differs (D-33); rows the setter
      // carried over are the store's own.
      replace(t, unwrapThin(result));
    }
  } finally {
    // The writes made stand, as a record's do when the setter throws.
    if (L !== null) L.close(open);
    if (!--writing && draftRead !== null) (joinFuture(draftRead), (draftRead = null));
    scopes.pop();
    session = ps;
    t0.ws = pw;
    userWrite = prevUser;
    if (__OBSERVE__ && writing === 0 && obsWrites !== null) flushWrites();
  }
  if (landed !== null && writing === 0) landed();
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
/** The optimistic engine's work after a whole landing (thinOptimistic.ts). */
let landed: (() => void) | null = null;
export const installThinLanded = (fn: () => void): void => void (landed = fn);

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

/** A list answering a derived store seeded with a record (a seedless
 * derive's `{}`): the root becomes a list, over a raw of its own. */
export function thinListRoot(proxy: any): void {
  const t: Target = proxy[$THIN];
  if (!t.r && t.c === null) {
    t._fam!.map.set((t.v = []), t as any);
    t.r = true;
    if ((t.l = !!t._fam!.opt)) L!.root(t);
  }
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
// Descend only where a proxy exists below: a subtree nobody read has no
// identity or readers to keep, so the new value just takes the slot.
let sentFor: any = null;
let sentSet: Set<any> | null = null;
/** `pv` is re-sent elsewhere in `next`, the parent's new value. */
function resent(t: Target, next: any, pv: any): boolean {
  if (t.r) {
    // A Set costs more to build than a short list costs to scan.
    if (next.length < 9) return next.includes(pv);
    if (sentFor !== next) ((sentFor = next), (sentSet = new Set(next)));
    return sentSet!.has(pv);
  }
  for (const k in next) if (next[k] === pv) return true;
  return false;
}
/** The draft's value of a key: the raw's while no write moved it. */
const curOf = (t: Target, key: PropertyKey): any =>
  !t.w && t.c === null ? seed(t, key) : valueOf(t, key);
/** A row no write moved off its raw keys by the raw (no proxy read). */
function keyOf(map: WeakMap<object, any>, keyFn: (v: any) => any, p: any): any {
  if (!isWrappable(p)) return undefined;
  const pt = map.get(p);
  return pt !== undefined && (pt.w || pt.c !== null) ? keyAt(keyFn, pt) : keyFn(p);
}
/** A written row's key: a named key (`reconcile(v, "id")`, its keyFn
 * carries the name) is read off the draft, not through the proxy, unless
 * it is an object or the prototype may answer it. */
function keyAt(keyFn: (v: any) => any, pt: Target): any {
  const k = (keyFn as any).k;
  if (k !== undefined && pt.c === null && pt.o === null) {
    const v = valueOf(pt, k);
    if (v === ABSENT ? !(k in pt.v) : v === null || typeof v !== "object")
      return v === ABSENT ? undefined : v;
  }
  return keyFn(pt.p);
}
/** The source last merged into a plain store's row, re-sent and nothing
 * written since: the row stays, with nothing to diff. */
const kept = (t: Target, next: any, map: WeakMap<object, any>, pv: any, nv: any): boolean =>
  t._fam === null && map.get(pv)?.sv === nv && !map.has(nv) && !resent(t, next, pv);
function merge(
  t: Target,
  next: any,
  map: WeakMap<object, any>,
  keyFn: ((v: any) => any) | null,
  pv: any,
  nv: any,
  paired?: boolean
): any {
  // The same raw re-sent over a row a write moved off it: back to the raw.
  if (pv === nv) {
    if (isWrappable(nv)) {
      const pt = map.get(pv);
      if (pt?.w) ((pt.ws = t.ws), reconcileTarget(pt, nv, keyFn, 0), (pt.w = false));
    }
    return nv;
  }
  if (typeof nv !== "object" || nv === null) return nv;
  // A row nothing ever wrapped has no identity or readers to keep.
  if (t._fam === null && map.get(pv) === undefined && !isThin(nv)) return nv;
  if (kept(t, next, map, pv, nv)) return pv;
  // A store inside a derive's value: the slot chains to it (#2864).
  if (t._fam !== null && isThin(nv) && nv[$THIN]._fam !== t._fam) return chainSlot(t, nv);
  if (isThin(nv) && isThin((nv = held(t, nv)))) return nv;
  if (pv === nv || !isWrappable(pv) || !isWrappable(nv) || Array.isArray(pv) !== Array.isArray(nv))
    return nv;
  const pt = map.get(pv);
  // A raw already wrapped, or re-sent at another slot, is its own row:
  // identity travels with the raw (#4001).
  // (A row chained to a store is that store's alias, never a plain row's.)
  if (pt === undefined || pt.c !== null || map.has(nv) || resent(t, next, pv)) return nv;
  // A keyed diff of a plain store does not walk a value nothing below ever
  // read through a node (a proxy alone, read untracked): the slot takes the
  // new raw whole and a capture may detach (#2902, the pruning contract).
  // A list row matched by key keeps its proxy and is merged one level; its
  // node-less children are still swapped whole (#5220). Positional and
  // derived diffs adopt.
  if (!pt.d && keyFn !== null && t._fam === null && !paired) return nv;
  // `paired`: the list pass already matched the two rows' keys.
  if (keyFn !== null && !paired) {
    const pk = pt.w || pt.c !== null ? keyAt(keyFn, pt) : keyFn(pv);
    if (pk !== undefined && pk !== keyFn(nv)) return nv;
  }
  // The same source re-sent over a row it was merged into, untouched since:
  // nothing to diff (the identity skip a written row lost its raw for).
  pt.ws = t.ws;
  reconcileTarget(pt, nv, keyFn, 0);
  if (t._fam === null) pt.sv = nv;
  return pv;
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
    if (isThin(next) && next[$THIN]._fam !== t._fam) return (chainTo(t, next), answered(t));
    if (t.c !== null) unchain(t);
  }
  next = unwrapThin(next);
  if (next === t.v && t.n === null && !(t.l && (t.k !== null || t.da !== null))) return;
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
      for (const key of ownOf(next)) (rawThin(next[key]), write(t, key, next[key]));
    }
    return;
  }
  const map: WeakMap<object, any> = (t._fam?.map as any) ?? targets;
  if (t.r) {
    const len = curOf(t, "length");
    const sf = sentFor,
      ss = sentSet;
    const bf = bumpFor,
      bd = bumped;
    if (t._fam === null) ((bumpFor = t), (bumped = false));
    let byKey: Map<any, any> | null = null;
    let made: Set<any> | null = null;
    // The old rows' keys from the first mismatch on (`keyOf` once per row).
    let oldKeys: any[] | null = null;
    let oldVals: any[] | null = null;
    for (let i = 0; i < next.length; i++) {
      const nv = next[i];
      // An unwritten list's slot is its raw's (an index is no prototype's).
      let cur = i >= len ? ABSENT : oldVals !== null ? oldVals[i] : undefined;
      if (i < len && oldVals === null)
        cur = !t.w && t.c === null && (cur = t.v[i]) !== undefined ? cur : curOf(t, i);
      let pv = i < len ? cur : undefined;
      // The same raw at the same slot, its row unmoved by a write: the
      // write would be a no-op and there is nothing below to diff.
      if (pv === nv && (typeof nv !== "object" || nv === null || !map.get(nv)?.w)) continue;
      // The source last merged into the row at this slot, re-sent and
      // nothing written since: no pairing or diff (`merge`'s identity skip,
      // and the slot keeps its row, so the write is a no-op).
      if (kept(t, next, map, pv, nv)) continue;
      const nk = keyFn !== null && isWrappable(nv) ? keyFn(nv) : undefined;
      if (
        nk !== undefined &&
        (oldKeys !== null && i < len ? oldKeys[i] : keyOf(map, keyFn!, pv)) !== nk
      ) {
        if (byKey === null) {
          // Every slot before `i` kept its own row (paired by key at its
          // slot), so only the rows from `i` on can answer a later key.
          byKey = new Map();
          oldKeys = [];
          oldVals = [];
          for (let j = i; j < len; j++) {
            const p = (oldVals[j] = j === i ? cur : curOf(t, j));
            const k = keyOf(map, keyFn!, p);
            oldKeys[j] = k;
            if (k !== undefined && !byKey.has(k)) byKey.set(k, p);
          }
          // The truth answering a guessed row (a push the user made) takes
          // that row's identity: the row keeps its proxy and readers (D-34,
          // store/optimistic.ts `pairRows`).
          if (t.l) made = L!.made(t, byKey, g => keyOf(map, keyFn!, g));
          // A returned answer pairs a row the list no longer holds with the
          // guessed target of its key, as a draft's write does (#4907, the
          // set trap's keyed pairing): the row keeps its guess.
          if (guessed !== null && t._fam?.opt && famGuessing(t._fam))
            for (const c of t._fam.live as unknown as Set<Target>)
              if (c !== t && hasGuess(c)) {
                const k = keyOf(map, keyFn!, c.v);
                if (k !== undefined && !byKey.has(k)) byKey.set(k, c.v);
              }
        }
        pv = byKey.get(nk);
      }
      // The truth of a row the guess made is the guess's hold's until it
      // commits: the screen keeps the row as guessed (D-34).
      const hi = holdIn;
      if (made?.has(pv)) holdIn = L!.hold(t);
      const m = merge(t, next, map, keyFn, pv, nv, nk !== undefined);
      holdIn = hi;
      if (t._fam !== null) write(t, i, m);
      else if (!Object.is(cur, m)) write(t, i, m, cur);
    }
    ((sentFor = sf), (sentSet = ss));
    for (let i = next.length; i < len; i++) write(t, i, ABSENT);
    if (bumpFor === t) {
      const hit = bumped;
      ((bumpFor = bf), (bumped = bd));
      if (hit && t.k !== null) put(t, t.k, (x: number) => x + 1);
    }
    write(t, "length", next.length);
    return;
  }
  // Keys `next` lacks go absent (`write` skips one already absent).
  if (t.c !== null) {
    for (const key of keysOf(t)) if (!hasOwn.call(next, key)) write(t, key, ABSENT);
  } else {
    for (const key of (t.mk ??= ownOf(t.v))) if (!hasOwn.call(next, key)) write(t, key, ABSENT);
    const n = t.n;
    if (n !== null && t.x)
      for (const key of Reflect.ownKeys(n))
        if (!hasOwn.call(t.v, key) && !hasOwn.call(next, key)) write(t, key, ABSENT);
  }
  const keys = ownOf(next);
  // Only a record with a key `Object.keys` leaves out can hide one.
  const hides = Object.keys(next).length !== keys.length;
  for (const key of keys) {
    const pv = curOf(t, key);
    const nv = next[key];
    // A key `next` hides keeps its attribute (A29, #3706).
    if (hides && !propertyIsEnumerable.call(next, key)) {
      if (!(pv instanceof Box && !pv.d.enumerable && Object.is(pv.d.value, nv)))
        write(
          t,
          key,
          new Box({ value: nv, writable: true, enumerable: false, configurable: true })
        );
    } else if (typeof nv !== "object" || nv === null) {
      if (pv !== nv) write(t, key, nv, t._fam === null ? pv : write);
    } else if (pv !== nv || map.get(nv)?.w) {
      const m = merge(t, next, map, keyFn, pv === ABSENT ? undefined : pv, nv);
      if (t._fam !== null) write(t, key, m);
      else if (!Object.is(pv, m)) write(t, key, m, pv);
    }
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
  // A store held inside another's value is read as its own family's.
  if (isThin(value)) fam = value[$THIN]._fam;
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
      if (t.l && L!.ix(k) !== -2) {
        copy[k] = thinSnapshot(valueOf(t, k), seen, fam);
        continue;
      }
      const node = t.n?.[k as any];
      const own = node !== undefined && peek(node, t) !== DELEGATE;
      const iv = own ? undefined : valueOf(it, k);
      // A child read through the chain is this family's sub-chain: its
      // guesses are part of the frame (#2932).
      const sc = own
        ? undefined
        : t.r && isObj(iv)
          ? rowChains.get(t)?.get((((it._fam?.map as any) ?? targets).get(iv) as Target)?.p)
          : subChains.get(t)?.get(k);
      copy[k] = own
        ? thinSnapshot(valueOf(t, k), seen, fam)
        : sc !== undefined && unwrapThin(sc.c) === iv
          ? thinSnapshot(sc.p, seen, fam)
          : thinSnapshot(iv, seen, it._fam);
    }
    return copy;
  }
  seen.set(raw, raw);
  let copy: any = null;
  const keys = keysOf(t);
  // A raw of plain data copies by assignment: no descriptor per key.
  if ((t.pl ??= plainData(raw, t.r))) {
    const w = t.w;
    if (w) copy = copyOf(t, raw, keys, seen, 0); // unwritten: every node holds the raw
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (t.r && k === "length") continue;
      const v = w ? valueOf(t, k) : raw[k];
      if (v instanceof Box) {
        if (copy === null) copy = copyOf(t, raw, keys, seen, i);
        setProp(copy, raw, k, v);
        continue;
      }
      const c = v !== null && typeof v === "object" ? thinSnapshot(v, seen, fam) : v;
      if (copy === null && c !== v) copy = copyOf(t, raw, keys, seen, i);
      if (copy !== null) copy[k] = c;
    }
    return copy ?? raw;
  }
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
/** Every own property of `o` is plain data (an array's `length` aside). */
function plainData(o: any, r: boolean): boolean {
  for (const k of ownOf(o)) {
    if (r && k === "length") continue;
    const d = Object.getOwnPropertyDescriptor(o, k)!;
    if (d.get || d.set || !d.enumerable || !d.writable) return false;
  }
  return true;
}
/** A snapshot's copy of a plain-data target, its first `n` keys taken
 * from the raw (the ones the walk passed unchanged). */
function copyOf(t: Target, raw: any, keys: PropertyKey[], seen: Map<object, any>, n: number): any {
  const copy: any = t.r ? [] : Object.create(protoNow(t));
  seen.set(raw, copy);
  if (t.r) copy.length = valueOf(t, "length");
  for (let i = 0; i < n; i++) {
    const k = keys[i];
    if (!(t.r && k === "length")) copy[k] = raw[k];
  }
  return copy;
}

/** Tracking copy: subscribes to every reachable key set and value, and
 * returns snapshot()'s copy (its shape and identity). */
const isObj = (v: any): boolean => v !== null && typeof v === "object";
export function thinDeep(value: any): any {
  const seen = new Set<Target>();
  // The traps called directly: a Proxy's invariant checks cost as much again.
  const walk = (v: any) => {
    const t: Target | undefined = isThin(v) ? v[$THIN] : undefined;
    if (t === undefined || seen.has(t)) return;
    seen.add(t);
    // A plain store's target is one node for it (bumped by every write to
    // it, its key set's too): values and keys are read, not tracked.
    if (t._fam === null && t.c === null && !inDraft(t) && getObserver() !== null) {
      read((t.dv ??= slot(t, 0, isEqual, $DEEP)) as any);
      for (const k of keysOf(t)) {
        // A leaf's node outside any lane, primitive staged and committed:
        // nothing below it to walk (the frame value is one of the two).
        const n = t.n?.[k as any];
        if (
          n !== undefined &&
          n._x === null &&
          !isObj(n._value) &&
          (n._pendingValue === NOT_PENDING || !isObj(n._pendingValue))
        )
          continue;
        const c = valueOf(t, k);
        if (c !== null && typeof c === "object" && !(c instanceof Box)) walk(child(t, c));
      }
      return;
    }
    const shell = { [$S]: t };
    for (const k of ownKeysOf(t)) walk(BASE.get!(shell, k, t.p));
  };
  walk(value);
  // One untracked frame for the copy, not one per value read.
  return untrack(() => thinSnapshot(value));
}

// Devtools `DEV.setSignal` on a store slot node goes through the setter.
let writerChained = false;
function chainDevWriter(): void {
  writerChained = true;
  registerDevStoreSlotWriter((node, value) => {
    const host = (node as any)._host;
    const key = (node as any)._key;
    if (host && host.p && key !== $TRACK && host.n?.[key] === node)
      return thinSetter(host.p, (d: any) => void (d[key] = value));
    setSignal(node, value as any);
  });
}

/** For the optimistic list engine (thinList.ts). */
export {
  ABSENT as ABSENT_THIN,
  CHAINED,
  DELEGATE,
  carries,
  child as thinChild,
  frameRead,
  inDraft,
  inner as thinInner,
  keyNode,
  keyOf as thinKeyOf,
  nodeOf as thinNodeOf,
  noteParent,
  peek as thinPeek,
  placed,
  put as thinPut,
  replace as thinReplace,
  stageRow,
  subChain,
  echo as thinEcho,
  guess as thinGuess,
  guessed as thinGuessed,
  under as thinUnder,
  userWrite as thinUserWrite,
  writing as thinWriting
};
export type { Target as ThinTarget };
