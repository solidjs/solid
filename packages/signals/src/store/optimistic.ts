/**
 * Store — optimistic stores on lanes (plan sec. 31, S4; INTERNALS §3/§7, RUL-3;
 * S2: a guess is a patch).
 *
 * No store-side layer, no backup snapshots, no retaining ledger: a user
 * write to an optimistic store is one GUESS per target — the user's draft,
 * carried by the target's guess carrier (`kg`, a `$PATCH` slot node like a
 * hold's), with the keys the draft changed recorded on it. Lanes do the rest
 * on that one node (`optimisticWrite`, the same write `createOptimistic`'s
 * setter makes): the guess shows under the action's hold, a landing beneath
 * it stages as truth and confirms it when equal (A18/A24), the action's
 * settle dissolves it (a revert to the frame it covered, or the landed
 * truth). The committed backing is never touched by a guess; a guess folds
 * nothing (its truth lands through its own batch).
 *
 * Reads find the carrier by key (store.ts `frameOf`: a key the guess
 * changed reads through it, tracked, by core's lane rules — what the lane
 * shows; presence, descriptors and enumeration are the patch frame's). A
 * chained target's committed frame is the inner store's proxy: an unguessed
 * key reads through to the inner store's current frame by construction.
 *
 * Landings (Q-D, plan sec. 31.7): the derive's output is reconciled against the
 * optimistic VIEW — a row the guess added and the server returns with the
 * same key in the same position keeps its proxy (the row target adopts the
 * server object) — and reaches the carrier as a truth frame (store.ts
 * `notifyWrites` → `setSignal` → lanes `laneWrite`), judged over the guess's
 * own keys (`echoes`): confirmed beneath, re-based over an older truth
 * (`_laneRebase`), folded (D-34), or a correction.
 */
import {
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_OVERRIDE,
  EFFECT_RENDER,
  NOT_PENDING,
  STATUS_PENDING,
  REACTIVE_REASK
} from "../core/constants.js";
import {
  context,
  isEqual,
  joinPassAt,
  read as readNode,
  setSignal,
  slotSignal,
  untrack
} from "../core/core.js";
import { link } from "../core/graph.js";
import { getObserver } from "../core/owner.js";
import { devGuardOptimisticBeforeLoad } from "../core/dev.js";
import { latestOf, setLaneValue } from "../core/lanes.js";
import { guessedValueOf, optimisticWrite, pendingGuessOf, take } from "../core/guesses.js";
import { covered } from "../core/truth.js";
import {
  clock,
  GlobalQueue,
  holdNode,
  insertSubs,
  joinFuture,
  laneDirty,
  merge,
  passLane,
  resolveTx,
  staleReader,
  txOf,
  type Transaction
} from "../core/scheduler.js";
import type { Computed, Signal } from "../core/types.js";
import type { Refreshable } from "../core/index.js";
import { createProjectionInternal } from "./projection.js";
import { reconcileState } from "./reconcile.js";
import {
  cloneRaw,
  committed,
  getHasNode,
  getNode,
  linkedTo,
  nameCarrier,
  sameKey,
  serveKeyValue,
  storeSetter,
  targetsEqual,
  unwrapValue
} from "./store.js";
import { installOptHooks } from "./hooks.js";
import { $OWNER, lookupTarget, type StoreFamily, type StoreTarget } from "./target.js";
import {
  $PATCH,
  $TARGET,
  isWrappable,
  type NoArray,
  type NoFn,
  type ProjectionOptions,
  type Store,
  type StoreOptions,
  type StoreSetter
} from "./types.js";

const hasOwn = Object.prototype.hasOwnProperty;

/** S2 — a target's guess carriers, one per lane (per action): `$PATCH` slot
 * nodes whose lane value is the user's draft, the keys it changed recorded
 * (`wk`, `del`; a keyed list's rows as written and removed keys with it).
 * Oldest first; a carrier that is no lane's is dropped (`sweepOverlaid`).
 * Off the target (a plain store carries nothing for the optimistic engine). */
const carriers: WeakMap<StoreTarget, Signal<any>[]> = new WeakMap();
const kgOf = (t: StoreTarget): Signal<any>[] | null => carriers.get(t) ?? null;
const INDEX = /^(0|[1-9]\d*)$/;
/** The newest live guess carrier for `key`, if any: a lane's guess, or one a
 * correction re-homed into its hold (HELD) — the screen keeps what it showed
 * until that hold lands (A18 (c)), a member reads the truth beneath;
 * `read()` of the carrier decides. Its record (`wk`, `del`) has the key —
 * or, for a read (`reads`), the key is an index or the length of a keyed
 * list's arrangement guess (`g`): a list reader enters the lane through
 * them, as it did through the guessed container. A landing asks without
 * `reads`: a key the guess only carried over is the truth's, and its leaf
 * tells its readers as ever (store.ts `leafSet`). */
function guessFor(
  t: StoreTarget,
  key: PropertyKey,
  shape = false,
  reads = true
): Signal<any> | null {
  const kg = kgOf(t);
  if (kg !== null)
    for (let i = kg.length - 1; i >= 0; i--) {
      const g: any = kg[i];
      if (
        g._config & (CONFIG_OVERRIDE | CONFIG_HELD) &&
        (g.wk?.has(key) ||
          g.del?.has(key) ||
          (reads &&
            g.g !== undefined &&
            (key === "length" || (typeof key === "string" && INDEX.test(key)))))
      )
        return g;
    }
  return null;
}
/** The newest live guess carrier (the frame a structural read sees). */
function newestGuess(t: StoreTarget): Signal<any> | null {
  const kg = kgOf(t);
  if (kg !== null)
    for (let i = kg.length - 1; i >= 0; i--)
      if (kg[i]._config & (CONFIG_OVERRIDE | CONFIG_HELD)) return kg[i];
  return null;
}
/** The hold's carrier of a truth staged beneath the screen: the container
 * node while a transaction holds its staging (a landing adopted under an
 * action), else null. A guess made over it carries that truth beneath. */
function heldCarrier(t: StoreTarget): Signal<any> | null {
  const k = t.k;
  return k !== null && k._config & CONFIG_HELD && k._pendingValue !== NOT_PENDING ? k : null;
}
/** A guessed key's value from the carrier's frame. */
function carrierValue(frame: Record<PropertyKey, any>, key: PropertyKey): any {
  return hasOwn.call(frame, key) || key !== "__proto__" ? frame[key as any] : undefined;
}

/** An optimistic setter's targets whose staging was set aside (`draft`),
 * restored when the setter's writes become guesses (`writes`). */
const optStaged: Map<StoreTarget, Record<PropertyKey, any>> = new Map();

/** The view the setter composes on (`writer`): the committed frame — a
 * chained backing resolved through the inner store's — with the lane's
 * value and the tick's own guess over it; `plain`: the committed frame
 * alone (the comparator's world). */
function writerBacking(t: StoreTarget, plain = false): Record<PropertyKey, any> {
  const base = committed(t);
  const inner: StoreTarget | undefined = (base as any)[$TARGET];
  const src = inner === undefined ? base : writerBacking(inner, plain);
  return plain ? src : guessView(t, src, true);
}
/** `src` with the target's guess over it: the carrier's unflushed guess or
 * lane value when it carries one, else `src` itself. */
function guessView(
  t: StoreTarget,
  src: Record<PropertyKey, any>,
  writer = false
): Record<PropertyKey, any> {
  const kg = kgOf(t);
  if (kg !== null)
    for (let i = kg.length - 1; i >= 0; i--) {
      const g = kg[i];
      if (writer) {
        // The writer composes on the screen with the tick's own guesses: the
        // unflushed guess, the lane's value, a corrected guess's screen until
        // its hold lands (D-34, D-37 — never the truth beneath it).
        if (g._config & CONFIG_OVERRIDE || pendingGuessOf(g) !== NOT_PENDING) {
          const v = guessedValueOf(g);
          if (v !== NOT_PENDING) return v as Record<PropertyKey, any>;
        }
        if (g._config & CONFIG_HELD) return g._value as Record<PropertyKey, any>;
      } else if (g._config & (CONFIG_OVERRIDE | CONFIG_HELD)) {
        // A snapshot, `deep()`, a reconcile's key matching: the carrier as
        // core reads it for this reader (the lane's world, the screen, the
        // truth beneath — the same frame the per-key reads compose).
        const v = untrack(() => readNode(g));
        if (v !== NOT_PENDING) return v as Record<PropertyKey, any>;
      }
    }
  return src;
}

/** The user's draft on an optimistic family: a clone of the view the user
 * saw (#3665). A staging already on the target (a landing adopted this
 * flush) is set aside for the setter's duration: the guess goes over it, it
 * stays the truth beneath. */
function optimisticDraft(t: StoreTarget): Record<PropertyKey, any> {
  if (t.pb !== null) optStaged.set(t, t.pb);
  return cloneRaw(writerBacking(t), t);
}

/** The target's guess carrier, made at the first guess: its committed value
 * the frame the guess is shown over. Its comparator judges a truth against
 * the guess over the keys the guess changed (`echoes`: the server's echo of a
 * guessed row is a new object with the same contents, #3898). */
function guessCarrier(t: StoreTarget, keys?: Set<PropertyKey>): any {
  let kg = kgOf(t);
  if (kg === null) carriers.set(t, (kg = []));
  // The carrier a guess goes on: one with a guess still unflushed (this
  // flush's: one lane), or a live one whose record shares a key (two
  // suggestions for one slot entangle their frames, A34 (1) — as the one
  // leaf node did); else a new one — another action's guess of other keys
  // is its own lane's.
  for (let i = kg.length - 1; i >= 0; i--) {
    const g: any = kg[i];
    const live = g._config & (CONFIG_OVERRIDE | CONFIG_GUESS);
    if (!live && pendingGuessOf(g) === NOT_PENDING) continue;
    if (pendingGuessOf(g) !== NOT_PENDING || keys === undefined) return entangle(t, g, keys);
    if (g.wk !== null) for (const key of keys) if (g.wk.has(key) || g.del?.has(key)) return g;
  }
  const g: any = slotSignal(committed(t), patchEquals, t, $PATCH, false);
  if (__OBSERVE__) nameCarrier(g, t);
  // Written over a held truth (a landing the target's hold keeps beneath
  // the screen): that truth is the one beneath the guess, judged at the
  // body's end (A18, #3330) — as it was the leaf's staging.
  const p = heldCarrier(t);
  if (p !== null) {
    g._pendingValue = p._pendingValue;
    holdNode(g, txOf(p));
  }
  g.guess = true;
  g.wk = null;
  g.del = null;
  g.removed = null;
  g.g = undefined;
  kg.push(g);
  return g;
}
/** This flush's carrier writes a key another action's live guess holds: two
 * suggestions for one slot, and their frames entangle (A34 (1)) — as the one
 * leaf node's lanes merged at the seam (`applyGuesses`): an unapplied
 * carrier is held on that guess's frame, so its lane is born under it; an
 * applied one's frame merges now. */
function entangle(t: StoreTarget, g: any, keys: Set<PropertyKey> | undefined): any {
  if (keys !== undefined)
    for (const o of kgOf(t)! as any[])
      if (o !== g && o._config & CONFIG_OVERRIDE && o.wk !== null)
        for (const key of keys)
          if (o.wk.has(key) || o.del?.has(key)) {
            const holder = resolveTx(txOf(o)._parent!);
            if (g._config & CONFIG_OVERRIDE) merge(resolveTx(txOf(g)._parent!), holder);
            else if (!(g._config & CONFIG_HELD)) holdNode(g, holder);
            break;
          }
  return g;
}
/** The derive's open question is a re-ask of the same one (D-34 ¶3): its
 * own `refresh()`, or every source it waits on re-asked (`refresh(list)`
 * ahead of a sync derive over `list`, #4724) — an input re-asked is not an
 * input changed. A guess written over it stands in for the flight (A17). */
function reasked(d: Computed<any>): boolean {
  if (d._flags & REACTIVE_REASK || d._x?._reask) return true;
  const ps = d._x?._pendingSources;
  if (!ps?.size) return false;
  for (const s of ps)
    if (s === d || !((s as any)._flags & REACTIVE_REASK || (s as any)._x?._reask)) return false;
  return true;
}
function patchEquals(this: any, a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  // A chained backing (a proxy) is judged as the inner store's committed
  // frame: the proxy would serve the inner's staging, and a guess equal to
  // that staging is still a guess over the committed world.
  const at: StoreTarget | undefined = a[$TARGET];
  if (at !== undefined) a = writerBacking(at, true);
  const bt: StoreTarget | undefined = b[$TARGET];
  if (bt !== undefined) b = writerBacking(bt, true);
  const fam: StoreFamily = this._host._fam;
  // A structural guess: the arrangement (rows by identity or key, an
  // object's keys), as the container judged it.
  if (this.g !== undefined && !arrangementEqual(a, b, fam)) return false;
  // Each key the guess changed, by content: the same object, or the
  // server's echo of a guessed one — a new object with the same contents
  // (#3898). A row the adoption paired by key with a guessed one is not
  // thereby its equal: the leaves judged the content, so does the carrier.
  const wk: Set<PropertyKey> | null = this.wk;
  if (wk !== null)
    for (const key of wk) {
      if (key in a !== key in b) return false;
      if (!GlobalQueue._echoes!(a[key as any], b[key as any])) return false;
    }
  const del: Set<PropertyKey> | null = this.del;
  if (del !== null) for (const key of del) if (key in a !== key in b) return false;
  return true;
}

export function notifyOptimisticWrites(
  t: StoreTarget,
  pb: Record<PropertyKey, any>
): Record<PropertyKey, any> | null {
  // The view the user saw: the committed frame (a staging adopted eagerly is
  // not it) with the lane's value and the tick's own guess over it.
  const old = writerBacking(t);
  const isArr = Array.isArray(pb);
  const inner = t.ch ? (t.v as Record<PropertyKey, any>) : null;
  const changed = new Set<PropertyKey>();
  let del: Set<PropertyKey> | null = null;
  let structural = false;
  for (const key of Reflect.ownKeys(pb)) {
    if (key === $OWNER) continue;
    const nv = unwrapValue(pb[key as any]);
    if (!(key in old)) {
      changed.add(key);
      structural = true;
    } else {
      const previous = old[key as any];
      // A chained draft holds the inner store's raws: the inner's own frame.
      const ov = unwrapValue(inner !== null && previous ? previous : previous);
      // A row the setter carried over is not a write (#4724, the point of
      // write): the draft's rows are clones of the view's, so a carried row
      // is a new object with the view's contents — the same row, as the
      // server's echo of a guessed one is (`echoes`, #3898).
      if (!isEqual(ov, nv) && !targetsEqual(ov, nv)) {
        if (isArr && echoes(ov, nv)) {
          // The frame carries the row the view showed, not the draft's clone
          // of it: the same object wraps as the same proxy (a list keeps its
          // row identities across a structural guess, deep-chained-view).
          pb[key as any] = previous;
        } else {
          changed.add(key);
          if (isArr) structural = true;
        }
      }
    }
  }
  for (const key of Reflect.ownKeys(old)) {
    if (key === $OWNER || key in pb) continue;
    (del ??= new Set()).add(key);
    structural = true;
  }
  const staged = optStaged.get(t);
  if (staged !== undefined) optStaged.delete(t);
  if (changed.size === 0 && del === null) return staged ?? null;
  const g = guessCarrier(t, del === null ? changed : new Set([...changed, ...del]));
  // The record accumulates across a lane's writes to the same target.
  if (g.wk === null) g.wk = changed;
  else for (const key of changed) g.wk.add(key);
  if (del !== null) {
    if (g.del === null) g.del = del;
    else for (const key of del) g.del.add(key);
  }
  if (structural && isArr) {
    const rows = (pb as any[]).map(unwrapValue);
    // The keys of the view the setter saw that are not the guess's own
    // rows, which a re-base over another truth takes from that truth
    // (`_laneRebase`): the rows the setter removed, which it never brings
    // back, and the rows it only carried over from the truth beneath (the
    // committed row itself), which the new truth decides. Rows it added, or
    // carried from another action's guess, are the guesses' own: their
    // landings judge them. A set (empty or not) marks a keyed arrangement
    // guess (`fold`).
    let removed: Set<unknown> | null = null;
    const keyFn = t._fam!.key;
    if (keyFn !== null && keyFn !== undefined) {
      removed = new Set();
      const kept = new Set<unknown>();
      const base = committed(t) as any[];
      const truth = new Set(base);
      for (let i = 0; i < rows.length; i++) {
        const k = isWrappable(rows[i]) ? keyFn(rows[i]) : undefined;
        if (k !== undefined) kept.add(k);
      }
      // The view's rows, then the truth's: a truth row the view lacked was
      // removed by another action's guess, whose landing judges it — a
      // re-base never brings it back beside that guess (F-11, #4656).
      const n = (old as any[]).length;
      const all = [...(old as any[]), ...base];
      for (let i = 0; i < all.length; i++) {
        const r = unwrapValue(all[i]);
        const k = isWrappable(r) ? keyFn(r) : undefined;
        if (k !== undefined && (!kept.has(k) || (i < n && truth.has(r)))) removed.add(k);
      }
    }
    g.removed = removed;
    g.g = rows;
    // Written while the derive asks a new question (an input changed, not a
    // `refresh()`): the guess's base answers the old one, so the rows it only
    // carried over are that answer's — the new answer re-bases it like an
    // older truth instead of folding beneath it (`_laneRebase`, F-1, #4525).
    // A refresh's flight already up (`_reask`, the pass consumed the flag)
    // asks nothing new either (D-34 ¶3, #4656).
    const d = t._fam!.node;
    if (removed && d?._statusFlags! & STATUS_PENDING && !reasked(d!)) g.g = null;
  }
  // By value: the draft is the guess as written (a function leaf is a
  // value, not an updater, #3017).
  optimisticWrite(g, () => pb);
  if (t.dk !== null) optimisticWrite(t.dk, {} as any);
  markOverlaid(t);
  return staged ?? null;
}

type KeyFn = (item: any) => any;

/** Two arrangements (a guess's rows or keys against a truth's) by row
 * identity — by key when the family has one. */
function arrangementEqual(
  a: Record<PropertyKey, any>,
  b: Record<PropertyKey, any>,
  fam: StoreFamily
): boolean {
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as any[]).length) return false;
    for (let i = 0; i < a.length; i++) if (!rowSame(a[i], (b as any[])[i], fam)) return false;
    return true;
  }
  const ak = Reflect.ownKeys(a).filter(k => k !== $OWNER);
  const bk = Reflect.ownKeys(b).filter(k => k !== $OWNER);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!(k in b)) return false;
  return true;
}
function rowSame(a: any, b: any, fam: StoreFamily): boolean {
  if (isEqual(a, b) || targetsEqual(a, b)) return true;
  const keyFn = fam.key;
  if (!keyFn || !isWrappable(a) || !isWrappable(b)) return false;
  // A row the store already serves is its proxy's row: a reader (a list)
  // holds that proxy, so another object at the index is another row, by key
  // or contents alike — a guess's fresh object wraps a new proxy. A landing's
  // object has been adopted by the row it pairs with, so it serves that
  // row's proxy. Only rows no proxy serves yet pair by key, keyless rows by
  // position — reconcile's fallback (#3898).
  const ta = lookupTarget((a = unwrapValue(a)), fam);
  const tb = lookupTarget((b = unwrapValue(b)), fam);
  if (ta || tb) return ta === tb;
  // (Two keyless rows: `undefined` is the same key.)
  return sameKey(keyFn(a), keyFn(b));
}

/** Whether reconcile would write anything into `a` from `b`: wrappable
 * pairs descend, leaves compare as its writes do. A key mismatch is a
 * replacement, which a content difference already says. Plain data — the
 * server's echo of a guessed row is a new object with the same contents. */
function echoes(a: any, b: any): boolean {
  if (a === b) return true;
  if (!isWrappable(a) || !isWrappable(b)) return false;
  a = unwrapValue(a);
  b = unwrapValue(b);
  const ak = Object.keys(a);
  if (Array.isArray(a) !== Array.isArray(b) || ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (!hasOwn.call(b, k) || !echoes(a[k], b[k])) return false;
  return true;
}
// A cycle (a row that references itself) is not plain data: no match, so
// the landing stays a correction.
GlobalQueue._echoes = (a, b) => {
  try {
    return echoes(a, b);
  } catch {
    return false;
  }
};

/** Write `incoming` into the draft `draft` (a store proxy inside a user's
 * setter): arrays match rows by key (position when unkeyed) and recurse into
 * the matched row's draft; objects recurse into a wrappable pair, assign
 * otherwise; keys `incoming` lacks are deleted. */
function reconcileDraft(draft: any, incoming: any, keyFn: KeyFn | null): void {
  if (Array.isArray(incoming)) {
    const n = draft.length as number;
    const prev: any[] = new Array(n);
    for (let i = 0; i < n; i++) prev[i] = draft[i];
    let byKey: Map<any, any> | null = null;
    if (keyFn !== null) {
      byKey = new Map();
      for (let i = 0; i < n; i++) {
        const raw = unwrapValue(prev[i]);
        if (!isWrappable(raw)) continue;
        const k = keyFn(raw);
        if (k !== undefined && !byKey.has(k)) byKey.set(k, prev[i]);
      }
    }
    for (let i = 0; i < incoming.length; i++) {
      const nv = incoming[i];
      let match: any;
      if (isWrappable(nv)) {
        if (byKey !== null) {
          const k = keyFn!(nv);
          if (k !== undefined) match = byKey.get(k);
        } else if (i < n && isWrappable(unwrapValue(prev[i]))) match = prev[i];
      }
      if (match !== undefined) {
        if (unwrapValue(match) !== nv) reconcileDraft(match, nv, keyFn);
        if (draft[i] !== match) draft[i] = match;
      } else if (unwrapValue(draft[i]) !== nv) draft[i] = nv;
    }
    if (draft.length !== incoming.length) draft.length = incoming.length;
    return;
  }
  for (const k of Object.keys(incoming)) {
    const nv = incoming[k];
    const cur = draft[k];
    const curRaw = unwrapValue(cur);
    if (
      isWrappable(nv) &&
      isWrappable(curRaw) &&
      Array.isArray(nv) === Array.isArray(curRaw) &&
      (keyFn === null || Array.isArray(nv) || sameKey(keyFn(nv), keyFn(curRaw)))
    ) {
      if (curRaw !== nv) reconcileDraft(cur, nv, keyFn);
    } else if (curRaw !== nv) draft[k] = nv;
  }
  for (const k of Object.keys(draft)) if (!(k in incoming)) delete draft[k];
}

/** Core asks (scheduler `laneDirty`): the lane dirtied the target's guess
 * carrier — its readers are the readers of the leaves of the keys the guess
 * changed (they link their leaves, and the carrier once they read through
 * it): dirtied as the lane's work, with the presence nodes and the
 * container (a structural guess). */
/** The nodes the readers of a guess carrier's keys link: the leaves and
 * presence nodes of the keys it changed, and the container. */
function readersOf(n: any, fn: (node: Signal<any>) => void): void {
  if (n._key !== $PATCH || !n.guess) return;
  const t = n._host as StoreTarget;
  const each = (keys: Iterable<PropertyKey>) => {
    for (const key of keys) {
      const leaf = t.n?.[key as any];
      if (leaf !== undefined && leaf._subs !== null) fn(leaf);
      const has = t.h?.[key as any];
      if (has !== undefined && has._subs !== null) fn(has);
    }
  };
  each(n.wk ?? []);
  if (n.del !== null) each(n.del);
  const k = t.k;
  if (k !== null && k._subs !== null) fn(k);
}
GlobalQueue._slotDirty = (n, l) => readersOf(n, node => laneDirty(node, l));
/** Core asks (lanes `rerun`): a guess coming back at a landing re-derives
 * the carrier's readers there — the readers of its keys' leaves. */
GlobalQueue._slotRerun = (n, t) =>
  readersOf(n, node => {
    for (let s = node._subs; s !== null; s = s._nextSub) staleReader(s._sub, t);
  });
/** Core asks (lanes `laneWrite`): the family's derive, re-asking in a lane of
 * another action than the one that guessed this target, writes it — that
 * lane's new question, which the guess (over the old one) does not answer:
 * the carrier is the lane's derivation from here (F-6, #4336; lanes
 * `laneStage` for a node's own pass). */
GlobalQueue._slotTake = (n, back) => {
  const t = (n as any)._host as StoreTarget | undefined;
  if (back) {
    // The guess comes back (lanes `endLanes`): on the target's carrier — the
    // node itself, re-attached if the taker lane's end swept it (as the leaf
    // path re-made its node).
    markOverlaid(t!);
    let kg = kgOf(t!);
    if (kg === null) carriers.set(t!, (kg = []));
    if (kg.indexOf(n) === -1) kg.push(n);
    return n;
  }
  const d = t?._fam?.node?._x?._transaction;
  const g = txOf(n);
  if (!d?._lane || sameAction(d, g)) return false;
  // The re-ask takes the target's guess whole (the carrier and the deep
  // witness): a node other than the written one shows its truth in the
  // lane's world (lanes `take`).
  for (const m of [...(kgOf(t!) ?? []), t!.dk])
    if (m?._config! & CONFIG_GUESS && txOf(m!) === g) take(m!, d, m !== n);
  return true;
};
/** Q-D (plan sec. 39): an OLDER question's truth landed beneath a guess
 * (`laneWrite` held it — another action's landing is not this guess's
 * answer). The guess's edit is re-based over it: the truth frame with the
 * guess's own keys over it; a keyed list's order from the guess, rows from
 * the truth by key (a guessed row the truth has is the truth's object — the
 * row target adopted it, its proxy survives), rows the guess added — or
 * carried from another action's guess — kept (their landings judge them),
 * truth rows the guess lacks appended unless it removed them. A row the
 * guess only carried over from the truth it was written on is that truth's,
 * not the guess's: the new truth decides it, so after a new question the
 * old list's rows never show beside the new one's (F-1, D-35, #4482;
 * `removed`). Unkeyed lists compose positionally — the guess stands as
 * written (the documented residue). A current truth re-bases, the same way,
 * a guess written while its question was being asked (`g` null, #4525):
 * asked before the guess, it is the older question; its rows are held
 * beneath the guess. True: the lane holds the landing (`laneWrite`). */
GlobalQueue._laneRebase = (el: any, truth: unknown, older: boolean) => {
  const t: StoreTarget | undefined = el._host;
  // Not a store's: the lane judges the write (`supersede`).
  if (t === undefined) return false;
  if (el._key !== $PATCH) {
    // The deep witness's guess: a bump beneath a shown keyed arrangement
    // guess folds that lane (D-34), else the lane judges it.
    if (older) return true;
    const g = kgOf(t)?.find(c => c._config & CONFIG_OVERRIDE && (c as any).removed);
    return g !== undefined && (g as any).g !== null ? fold(g, truth) : false;
  }
  const guess = latestOf(el) as any;
  // A current truth: folded beneath a shown keyed arrangement guess (D-34).
  // Not folded (an object's guess, a lane that has not shown): held beneath
  // the guess for the hold's end, as a leaf's landing was — the screen keeps
  // the guess until the commit (D-34; #4690, the outside re-ask).
  if (!older && el.g !== null) return fold(el, truth);
  // An older question's truth, or the #4525 re-base: the guess's edit over it.
  if (!Array.isArray(truth) || !Array.isArray(guess)) return true;
  const keyFn = t._fam?.key;
  if (!keyFn) return;
  const byKey = new Map<unknown, any>();
  for (let i = 0; i < truth.length; i++) {
    const r = truth[i];
    const k = isWrappable(r) ? keyFn(r) : undefined;
    if (k !== undefined && !byKey.has(k)) byKey.set(k, r);
  }
  const used = new Set<unknown>();
  const removed: Set<unknown> = el.removed ?? new Set();
  const rows: any[] = [];
  // From the guess as written, not an earlier re-base's composition: a
  // derive's landing writes key by key, and a truth row one partial write
  // showed must not stay appended once the landing drops it (#4441).
  // The #4525 re-base (`g` null): the lane's rows are the new question's
  // answer now; its work reads that question's hold as the hold's own
  // flush does (core.ts `frameRead`, F-1, #4536).
  if (el.g === null) txOf(el).over = t._fam!.node!._x!._transaction!;
  const guessed: any[] = (el.g ??= guess.map(unwrapValue));
  for (let i = 0; i < guessed.length; i++) {
    const g = guessed[i];
    const k = isWrappable(g) ? keyFn(g) : undefined;
    const tr = k !== undefined ? byKey.get(k) : undefined;
    if (tr !== undefined) {
      // The truth's row under the guessed one's key: the guessed row's
      // target adopts it (the same proxy from here; its leaves tell its
      // readers what changed), as the derive's draft pairs new rows under
      // guessed ones (`pairRows`).
      const gt = isWrappable(g) ? lookupTarget(unwrapValue(g), t._fam!) : undefined;
      if (gt !== undefined && lookupTarget(tr, t._fam!) === undefined)
        reconcileState(tr, gt.px, keyFn, true);
      rows.push(tr);
      used.add(k);
    } else if (!removed.has(k)) rows.push(g);
  }
  for (let i = 0; i < truth.length; i++) {
    const r = truth[i];
    const k = isWrappable(r) ? keyFn(r) : undefined;
    if (k !== undefined && !used.has(k) && !removed.has(k)) rows.push(r);
  }
  // Every index of the composition is the guess's from here (a new row at
  // an index, the length): the record covers the frame.
  const wk: Set<PropertyKey> = el.wk ?? (el.wk = new Set());
  const n = Math.max(rows.length, guess.length, (committed(t) as any[]).length);
  for (let i = 0; i < n; i++) wk.add(String(i));
  wk.add("length");
  const l = txOf(el);
  setLaneValue(el, l, rows);
  // The composition changed what the lane shows (a truth row's content
  // under a guessed key, a row appended): the carrier's readers re-derive
  // as the lane's work (`laneDirty`; the leaf's `laneSet` did).
  if (!sameRows(guess, rows, t._fam!)) laneDirty(el, l);
  return true;
};
/** Two row lists show the same through the proxies: each slot the same
 * target (a row the guessed one's target adopted is the same proxy) or
 * the same primitive. */
function sameRows(a: any[], b: any[], fam: StoreFamily): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = unwrapValue(a[i]),
      y = unwrapValue(b[i]);
    if (isWrappable(x)) {
      const xt = lookupTarget(x, fam);
      if (xt === undefined || xt !== lookupTarget(y, fam)) return false;
    } else if (!isEqual(x, y)) return false;
  }
  return true;
}

/** D-34 for a keyed arrangement guess: rows by key, not positions. A
 * current truth that differs folds into the hold beneath it instead of
 * voiding the lane: the guess stays the lane's value and the screen's until
 * the hold commits, where rows match by key, and the graph outside the lane
 * re-derives from the truth now (`foldedRead`). A confirmation is silent
 * (A17): only truth readers are told. True: the lane stages the truth
 * beneath (`laneWrite`). */
function fold(el: any, truth: unknown): boolean {
  const l = txOf(el);
  // A guess the screen never showed is void at the correction (D-34); a
  // keyed arrangement guess's carrier carries its removed-keys set.
  if (!l._shown || !el.removed) return false;
  const guess = latestOf(el);
  if ((!el._equals || !el._equals(guess, truth)) && !GlobalQueue._echoes!(guess, truth))
    l.folded = foldedRead;
  else GlobalQueue._confirmed?.(l);
  // A folded lane's `latest()` serves the truth beneath the guess
  // (`foldedRead`): every truth landing there is news to its readers, a
  // confirming one too — they re-derive from it (D-34, F-6).
  if (l.folded) insertSubs(el);
  joinFuture(resolveTx(l._parent ?? l));
  return true;
}

/** A folded lane's guess read by a deriving pass outside the lane, tracked
 * or not (`untrack` is about dependencies, not about which world a pass
 * derives from), or by `latest()` (`c` null): the hold's world — the truth
 * staged beneath the guess, else the value it covered — and the pass joins
 * the hold. Lane passes and the screen keep the guess: held truth is masked
 * from lane passes only (#3164). The store's own derive reconciles its
 * landings against the arrangement the guesses made: it is the author, not
 * a reader. */
function foldedRead(c: Computed<any> | null, el: Signal<any> | Computed<any>): unknown {
  if (c !== null) {
    if (
      !(el._config & CONFIG_GUESS) ||
      passLane !== null ||
      (c as any)._type === EFFECT_RENDER ||
      c._config & CONFIG_CHILDREN_FORBIDDEN ||
      (el as any)._host?._fam?.node === c
    )
      return NOT_PENDING;
    const l = txOf(el);
    joinPassAt(c, resolveTx(l._parent ?? l));
  }
  if (el._pendingValue !== NOT_PENDING) return el._pendingValue;
  return covered(el);
}

/** D-34 for a per-key guess (#4329): the derive's draft wrote new objects
 * over a target holding guessed rows (`d.length = 0; d.push(...rows)`, or
 * `d.issues = rows`). The container on the way down to each guessed row
 * reconciles the new object at its slot — in a keyed list, the one with
 * the row's key — exactly as a returned landing would: rows match by key,
 * a guessed row keeps its target, and its leaves are judged against their
 * guesses. With no guess out, rows nothing guessed are left as the draft
 * wrote them. */
function pairRows(t: StoreTarget, pb: Record<PropertyKey, any>): void {
  const keyFn = t._fam!.key;
  for (let c of t._fam!._overlaid ?? []) {
    // The guessed row, or its ancestor directly under `t` (none: skip).
    while (c.u !== t) if ((c = c.u!) === null) break;
    if (c === null) continue;
    const k = keyFn?.(c.v);
    const nv = Array.isArray(pb)
      ? k !== undefined && pb.find(r => isWrappable(r) && sameKey(keyFn!(r), k))
      : pb[c.pk!];
    // A new object only: not `c`'s own, nor one another row serves
    // (pairing it would alias the two).
    if (isWrappable(nv) && !lookupTarget(nv, t._fam)) reconcileState(nv, c.px, keyFn, true);
  }
  // While guesses are out, every row of a keyed list keeps its target under
  // the derive's new object with its key, not only a guessed one (#4738): a
  // row whose guess settled can be guessed again, and the setter writes the
  // committed row's target — a landing must not show a new one in its place.
  if (keyFn && Array.isArray(pb) && t._fam!._overlaid?.size) {
    let byKey: Map<unknown, any> | null = null;
    for (const ov of committed(t) as any[]) {
      const rt = isWrappable(ov) ? lookupTarget(ov, t._fam) : undefined;
      if (rt === undefined) continue;
      if (byKey === null) {
        byKey = new Map();
        for (const r of pb) if (isWrappable(r)) byKey.set(keyFn(r), r);
      }
      const k = keyFn(ov);
      const nv = k === undefined ? undefined : byKey.get(k);
      if (nv !== undefined && !lookupTarget(nv, t._fam)) reconcileState(nv, rt.px, keyFn, true);
    }
  }
}

installOptHooks({
  pair: pairRows,
  draft: optimisticDraft,
  writes: notifyOptimisticWrites,
  view: guessView,
  reconcile: reconcileDraft,
  sweep: sweepOverlaid,
  // The carrier arms (store.ts calls them for an optimistic family's target
  // outside a draft and the write override): a key a live guess changed
  // reads through the carrier, tracked — the lane's seat, a verdict
  // window's judgment of the guess (A17/A24) — and the key's leaf stays the
  // reader's subscription point (silent while the guess covers it: the next
  // guess on the key, on a carrier of its own, reaches the reader through
  // it, `readersOf`). Presence and descriptors are the carrier frame's;
  // enumeration reads the newest carrier, tracked.
  read: (t, key) => {
    const g = guessFor(t, key);
    if (g === null) return NOT_PENDING;
    const frame = readNode(g) as Record<PropertyKey, any>;
    const obs = getObserver();
    const node = obs !== null ? getNode(t, key) : t.n?.[key as any];
    if (obs !== null) link(node!, obs as Computed<any>);
    return serveKeyValue(t, key, carrierValue(frame, key), false, node);
  },
  has: (t, key) => {
    const g = guessFor(t, key, true);
    if (g === null) return undefined;
    const obs = getObserver();
    if (obs !== null) link(getHasNode(t, key), obs as Computed<any>);
    return key in (readNode(g) as object);
  },
  descriptor: (t, key, array) => {
    const g = guessFor(t, key, true);
    if (g === null) return undefined;
    const obs = getObserver();
    if (obs !== null) link(getHasNode(t, key), obs as Computed<any>);
    const frame = readNode(g) as Record<PropertyKey, any>;
    if (!(key in frame)) return null;
    const value = frame[key as any];
    const length = key === "length" && Array.isArray(frame);
    return { value, writable: true, enumerable: !length, configurable: !(length && array) };
  },
  frame: t => {
    const g = newestGuess(t);
    return g === null ? NOT_PENDING : readNode(g);
  },
  // A key a live guess changed: its leaf is silent at a landing — its
  // readers read the carrier, whose judgement of the landing tells them (a
  // correction through the carrier, a confirmation silently, A17).
  covers: (t, key, shape) => guessFor(t, key, shape, false) !== null,
  // A landing reaches each live carrier as the truth it is judged against
  // (`laneWrite`: confirmed beneath, re-based, folded, or a correction) —
  // the frame as landed, not the backing by reference: a later batch writes
  // the backing in place, and a truth staged beneath a guess (a correction
  // held for the hold's end) must stay the answer it was.
  judge: (t, truth) => {
    const kg = kgOf(t);
    if (kg === null) return;
    const frame = Array.isArray(truth) ? (truth as any[]).slice() : { ...truth };
    for (let i = 0; i < kg.length; i++)
      if (kg[i]._config & (CONFIG_OVERRIDE | CONFIG_HELD)) setSignal(kg[i], frame);
  },
  // A new question (not a `refresh()`) asked over guesses an earlier frame
  // opened, which answer the old one (D-34, #4336). Stamped on `fam._asked`
  // with this flush's `clock`, so it lapses when the flush ends: `clock + 1`
  // from mainline over a live guess — a frame still reading a guess at the
  // seam shows it beside the new input, so the flush holds with the guess's
  // action (`park`); `~clock` from a lane with no guess of its own, or with
  // no live guess left — the lane waits for its answer (F-6), as for a
  // guessed `createOptimistic` (lanes `laneStage`). The guess's own lane
  // asks nothing new and stamps nothing.
  // A `refresh()` re-asks the guesses' own question (D-34 ¶3): a guess
  // stands in for its flight (A17), so a leaf lane work reads is kept off
  // the wake — the lane shows its guesses and the flight holds the lane's
  // parent, not the lane (F-11, #4656).
  ask: fam => {
    if (!fam._overlaid?.size) return;
    if (fam.node!._flags & REACTIVE_REASK) return (n: any) => n._subs._sub._x?._transaction?._lane;
    // Stamped with the flush (`clock`): it lapses when the flush ends.
    let a = ~clock;
    for (const g of fam._overlaid) {
      const n = laneNodeOf(g);
      if (n) {
        if (passLane === null) a = clock + 1;
        else if (sameAction(txOf(n), passLane)) return;
      }
    }
    if ((fam._asked = a) > 0) joinFuture(null);
  },
  // Over a new question the guesses do not answer (`_asked`): from mainline
  // only a target carrying a guess stands in — a read of one with none is an
  // ordinary pending read (F-2), so a keyed store's other keys wait for their
  // answer, not for the guess's action; in a lane with no guess of its own,
  // or with no live guess left, none does (F-6).
  // A reader already observing the flight (linked) keeps observing it:
  // served the guess, a re-run (the guess's own, the seam) would drop its
  // link and release the hold beside a guess over the previous answer
  // (F-1, #4536) — the ordinary read serves its committed frame or keeps it
  // pending. So does a reader in the frame's hold pending on a flight a list
  // guess was written over (`g` null, the #4525 mark; D-34: the guess does
  // not answer it): a render effect is read here, as `pullFamily`'s own read
  // would, since the frame's guard there returns early for an unlinked one.
  // A derivation a pending render effect reads (#4561), through any chain
  // of derivations (`held`), keeps observing a held flight as a stale reader
  // of its hold — linked, re-derived at the landing, so the hold still sees
  // its frame (`blockedBy`) — and is served the guess like lane work (a
  // `<For>` keeps showing it, #4525), its every read this pass (D-34 ¶3:
  // however the reads are grouped); a flight no transaction holds (a
  // `Loading on` fallback) it reads plainly.
  stands: t => {
    const f = t._fam!;
    const o = f._overlaid;
    const a = f._asked;
    const d = f.node!;
    const c: any = context;
    if (!o?.size || (a === clock + 1 && passLane === null && !o.has(t)) || a === ~clock)
      return false;
    // Linked by this pass's hold (below): its other reads keep the guess.
    const j = heldC === c && heldAt === clock;
    if (linkedTo(c, d)) return j && heldV > 1;
    if (kgOf(t)?.some(g => (g as any).g === null) && c?._statusFlags & STATUS_PENDING)
      if (c._type === EFFECT_RENDER) readNode(d);
      else if (j ? heldV : ((heldC = c), (heldAt = clock), (heldV = held(c))))
        d._x?._transaction ? (link(d, c), staleReader(c, txOf(d)), (heldV = 2)) : readNode(d);
    return true;
  },
  // Mainline hold (`clock + 1`): the flush joins the action of each guess a
  // reader still reads at the seam; a reader that moved off it (a keyed
  // store's other key) holds nothing.
  park: t => {
    for (const fam of overlaidFamilies)
      if (fam._asked === clock + 1)
        for (const g of fam._overlaid!) {
          const n = laneNodeOf(g, true);
          if (n) merge(txOf(n)._parent!, t);
        }
  }
});

/** A derivation in the frame's hold (scheduler.ts `blockedBy`): one a
 * pending render effect reads, through any chain of pending derivations
 * (#4561: memo -> memo -> binding, `mapArray` -> memo -> binding). Each
 * derivation is walked once (`seen`): a diamond graph stays linear. */
function held(c: any, seen = new Set()): true | undefined {
  for (let s = c._subs; s; s = s._nextSub) {
    const r: any = s._sub;
    if (
      r._statusFlags & STATUS_PENDING &&
      (r._type === EFFECT_RENDER || (!r._type && !seen.has(r) && (seen.add(r), held(r, seen))))
    )
      return true;
  }
}
/** The last reader judged (`heldC`) this pass (`heldAt`, the pass's `clock`)
 * and its verdict (`heldV`: 2 once this pass linked it): a reader's key reads
 * come in one run, so each does not re-walk its subscribers. */
let heldC: any, heldAt: number, heldV: any;

/** Two lanes of one action (their parents resolved through merges). */
function sameAction(a: Transaction, b: Transaction): boolean {
  return resolveTx(a._parent!) === resolveTx(b._parent!);
}

/** Families with a target carrying a lane value — swept at the flush's
 * commit (`sweepOverlaid`): a target whose carrier is no lane's any more
 * leaves its family's `_overlaid` and drops the carrier. (Not on the read
 * path: a guess is pending between the setter and the seam, and a read in
 * between must not take the target for clean.) */
const overlaidFamilies: Set<StoreFamily> = new Set();

function markOverlaid(t: StoreTarget): void {
  const fam = t._fam!;
  (fam._overlaid ??= new Set()).add(t);
  overlaidFamilies.add(fam);
}

export function sweepOverlaid(): void {
  if (overlaidFamilies.size === 0) return;
  for (const fam of overlaidFamilies) {
    const set = fam._overlaid!;
    for (const t of set)
      if (!laneNodeOf(t)) {
        set.delete(t);
        const live = kgOf(t)?.filter(
          g => g._config & CONFIG_HELD || g._pendingValue !== NOT_PENDING
        );
        if (!live || live.length === 0) carriers.delete(t);
        else carriers.set(t, live);
      } else if (kgOf(t) !== null) {
        // A carrier that is no lane's and no hold's (a corrected guess waits
        // for its hold's landing, A18 (c)) is done.
        const live = kgOf(t)!.filter(
          g =>
            g._config & (CONFIG_OVERRIDE | CONFIG_GUESS | CONFIG_HELD) ||
            g._pendingValue !== NOT_PENDING
        );
        if (live.length === 0) carriers.delete(t);
        else carriers.set(t, live);
      }
    if (set.size === 0) overlaidFamilies.delete(fam);
  }
}

/** The node of `t` carrying a lane value, if any — the guess carrier or the
 * deep witness (`read`: one a reader's last pass read). */
function laneNodeOf(t: StoreTarget, read?: boolean): Signal<any> | undefined {
  for (const n of [...(kgOf(t) ?? []), t.dk])
    if (n !== null && n._config & CONFIG_OVERRIDE) {
      if (!read) return n;
      for (let s = n._subs; s !== null; s = s._nextSub) if (s._gen === s._sub._depGen) return n;
    }
}

export function createOptimisticStore<T extends object = {}>(
  initialValue: NoFn<T> | Store<NoFn<T>>,
  options?: StoreOptions
): [get: Store<T>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
  seed?: null,
  options?: Omit<ProjectionOptions, "seedLoadingValue">
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
  seed: NoFn<T> | Store<NoFn<T>>,
  options?: ProjectionOptions
): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
export function createOptimisticStore<T extends object = {}>(
  first: T | ((store: T) => void | T | Promise<void | T> | AsyncIterable<void | T>),
  second?: NoFn<T> | Store<NoFn<T>> | StoreOptions | null,
  third?: ProjectionOptions
): [get: Store<T>, set: StoreSetter<T>] {
  const derived = typeof first === "function";
  // A derived store's family (projection.ts): the derive's status reaches
  // its leaves' readers as for `createStore(fn)` (F-12, #4437).
  const store = createProjectionInternal(
    (derived ? first : null) as any,
    (derived ? second : first) as T,
    (derived ? third : second) as ProjectionOptions,
    true
  );
  return [
    store,
    ((fn: (draft: T) => void) => (
      __DEV__ && derived && devGuardOptimisticBeforeLoad((store as any)[$TARGET]._fam.node),
      storeSetter(store, fn)
    )) as StoreSetter<T>
  ];
}
