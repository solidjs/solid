/**
 * Store rewrite — increment 2: plain deep stores with pending-backing writes.
 * Contract: INTERNALS-STORE-STATE.md.
 *
 * Write model (RUL-1, unified): the first draft write to a target creates its
 * pending backing `pb` — a descriptor-preserving CoW clone. The draft mutates
 * `pb` natively (array methods, defineProperty, deletes all just work).
 * Reads: drafts and owner-context reads see `pb`; context-free reads see the
 * committed `b` until flush. At flush commit (core's storeCommitHook), each
 * written target folds: diff old `b` vs new backing notifies exactly the
 * changed keys through equality-gated nodes, then `b` becomes the new
 * backing. Setter return-value replacement parks the UNOWNED incoming object
 * in `pb` — adoption: fold swaps it in, ownership resets (2026-08-16c).
 *
 * Nodes carry no pending state — they are pure subscription points; `pb` is
 * the pending home. Laziness: a written target with no subscriptions folds as
 * a pointer swap with zero node work.
 */
import { attrHooks } from "../../core/attribution-hooks.js";
import {
  $REFRESH,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_OWNED_WRITE,
  NOT_PENDING,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
  unwrapOverride,
  CONFIG_OPTIMISTIC
} from "../../core/constants.js";
import {
  devGuardStoreSetterWrite,
  isEqual,
  read as readNode,
  READ_SLOW,
  readNodeFast,
  setSignal,
  signal,
  untrack,
  ext
} from "../../core/core.js";
import { activeTransition, globalQueue, insertSubs } from "../../core/scheduler.js";
import { getObserver, getOwner } from "../../core/owner.js";
import {
  GlobalQueue,
  projectionWriteActive,
  schedule,
  setProjectionWriteActive,
  setStoreCommitHook
} from "../../core/scheduler.js";
import type { Signal } from "../../core/types.js";
import { pendingCheckActive, strictRead } from "../../core/core.js";
import {
  DEV,
  registerGraph,
  throwPendingUntrackedRead,
  warnStrictReadUntracked
} from "../../core/dev.js";
import {
  $AFFECTS,
  $PROXY,
  $TARGET,
  $TRACK,
  affectsScopesLive,
  getWriteOverride,
  inheritAffectsMarks,
  isRawValue,
  isWrappable,
  markRawIngest,
  markRawOne,
  rawValuesUsed,
  setNextAffectsNodeResolver,
  setNextOptimisticViewResolver,
  witnessAffectsMark
} from "../store.js";
import {
  devAssertNeverUserMutation,
  ingestedRaw,
  ownedRaw,
  storeNextLookup,
  type StoreNextFamily,
  type StoreNextTarget,
  optHooks
} from "./target.js";

// ---------------------------------------------------------------------------
// wrap / dedupe

/** Pre-shaped constructor for OBJECT proxy targets: V8 tips a bare `{}` into
 * dictionary mode once ~19 named properties are assigned onto it (the #3044
 * `ovl`/`del` fields crossed that line — every trap's field read became a
 * hash lookup, a 15% deep-dbmon tick regression). Declaring every field in a
 * constructor pre-allocates in-object slots so the map stays fast, with
 * headroom for future fields. The prototype is reset to `Object.prototype`
 * so proxy-forwarded semantics (getPrototypeOf, constructor) are exactly a
 * plain object's. Array targets keep the bare-`[]` path — they must carry
 * the array exotic class for `Array.isArray(proxy)`, and arrays store named
 * fields off-object where this cliff does not apply. */
function TargetShape(this: any) {
  this.v = undefined;
  this.ch = undefined;
  this.pb = undefined;
  this.n = undefined;
  this.h = undefined;
  this.k = undefined;
  this.dk = undefined;
  this.u = undefined;
  this.pk = undefined;
  this.px = undefined;
  this.d = undefined;
  this.a = undefined;
  this.sc = undefined;
  this.nc = undefined;
  this.adopted = undefined;
  this.fam = undefined;
  this.s = undefined;
  this.ovl = undefined;
  this.del = undefined;
}
TargetShape.prototype = Object.prototype;

function createTarget(
  value: Record<PropertyKey, any>,
  parent: StoreNextTarget | null,
  parentKey: PropertyKey | null,
  fam: StoreNextFamily | null = parent?.fam ?? null
): StoreNextTarget {
  // The proxy target carries the array exotic class when the value is an
  // array, so Array.isArray(proxy) is true; the fields live on it directly.
  // Direct field assignment in one fixed order (no Object.assign literal
  // copy): every target shares a hidden-class transition chain — createTarget
  // was the #2 store cost in the uibench creation profile.
  const t: StoreNextTarget = (Array.isArray(value) ? [] : new (TargetShape as any)()) as any;
  t.v = value;
  // Chained-backing flag (backing IS another store's proxy, §7b) — cached so
  // the hot read path never does a per-read symbol lookup on the backing.
  t.ch = (value as any)[$TARGET] !== undefined;
  t.pb = null;
  t.n = null;
  t.h = null;
  t.k = null;
  t.dk = null;
  t.u = parent;
  t.pk = parentKey;
  t.px = null;
  t.d = false;
  t.a = false;
  t.sc = false;
  t.nc = 0;
  t.adopted = false;
  t.fam = fam;
  t.s = false;
  t.ovl = false;
  t.del = null;
  t.px = new Proxy(t, traps);
  // Legacy interop: shared machinery (affects walks, wrap dedupe) reads the
  // proxy off looked-up targets as a field.
  (t as any)[$PROXY] = t.px;
  (fam?.map ?? storeNextLookup).set(value, t);
  if (__TEST__ && ingestedRaw && !ownedRaw.has(value)) ingestedRaw.add(value);
  return t;
}

export function wrapNext<T extends Record<PropertyKey, any>>(
  value: T,
  parent: StoreNextTarget | null = null,
  parentKey: PropertyKey | null = null,
  fam: StoreNextFamily | null = parent?.fam ?? null
): T {
  // markRaw'd values never wrap through ANY store (R42; sticky raw-marking
  // is one half of the never-both-wrapped-and-raw invariant, RUL-12).
  if (rawValuesUsed && isRawValue(value)) return value;
  const existing = (fam?.map ?? storeNextLookup).get(value);
  if (existing !== undefined) return existing.px;
  const t: StoreNextTarget | undefined = (value as any)[$TARGET];
  if (t !== undefined && t.px === value) {
    // Foreign-family proxies re-wrap into THIS family (writes stay isolated);
    // same-family and plain-store proxies pass through.
    if (fam === null || t.fam === fam) return value;
    return createTarget(value as any, parent, parentKey, fam).px;
  }
  return createTarget(value, parent, parentKey, fam).px;
}

/** Unwrap our own proxies to their current backing; leave everything else. */
export function unwrapValue(v: any): any {
  if (v == null || typeof v !== "object") return v;
  const t: StoreNextTarget | undefined = v[$TARGET];
  if (t !== undefined && t.px === v && t.v !== undefined) {
    // A draft escaping into other storage must be a REAL container that
    // becomes this target's committed backing at fold (the shared-raw
    // contract) — a prototype overlay is neither.
    if (t.ovl) materializePB(t);
    return t.pb ?? t.v;
  }
  return v;
}

// ---------------------------------------------------------------------------
// nodes: pure subscription points (values used only for equality gating)

export function getNode(target: StoreNextTarget, key: PropertyKey, current: any): Signal<any> {
  const nodes = (target.n ??= Object.create(null));
  let node: Signal<any> | undefined = nodes[key];
  if (node === undefined) {
    const created: Signal<any> = (node = signal(
      current,
      {
        // Attribution-only: name store property nodes by path segment so
        // attribution chains and wide-scope warnings read "store.todos", not
        // "signal". Gated on the engine being installed — node creation is
        // the hottest store path, and the disabled cost must stay one null
        // check (nodes created before enable() stay generically named).
        name: __DEV__ && attrHooks !== null ? "store." + String(key) : undefined,
        // Logical-slot equality: values resolving to the same child target
        // are the same slot (privatization/adoption swap raw identity without
        // changing the logical value — only changed leaves notify, R9).
        equals: (a: any, b: any) => isEqual(a, b) || sameLogicalSlot(target, a, b),
        unobserved() {
          // A live affects() mark keeps the node addressable (sweep parity).
          if ((created as any)._x?._affectsCount) return;
          if (target.n && target.n[key] === created) {
            delete target.n[key];
            target.nc--;
          }
        }
      },
      // Projection nodes carry the projection computed as their firewall:
      // reads through them link the derive's status/lifecycle (§7b).
      (target.fam?.node as any) ?? undefined
    ));
    // Store nodes are ownedWrite: the setter carries the owned-scope write
    // guard; node-level setSignals are internal notification machinery.
    created._config |= CONFIG_OWNED_WRITE;
    // Accessor-ness resolved ONCE per node (no per-object descriptor scan):
    // accessor keys serve through Reflect.get with the proxy receiver.
    (created as any).acc = isOwnAccessor(target.pb ?? target.v, key);
    // Wrap cache: the proxy last served for this key and the raw it wrapped.
    // Raw-as-truth stores raw in nodes, so every object read needs a wrapper;
    // one pointer compare (pxv === value) replaces the per-read WeakMap
    // lookup in wrapNext — the dominant read-path cost vs legacy, whose
    // nodes stored pre-wrapped values. A replaced child fails the compare
    // and re-wraps; at most one stale proxy is pinned until the next read.
    (created as any).px = undefined;
    (created as any).pxv = undefined;
    // Optimistic families: arm the override slot — setSignal routes armed
    // nodes through the core engine (lanes, ownership, reverts all native).
    if (target.fam?.opt) {
      ext(created)._overrideValue = NOT_PENDING;
      created._config |= CONFIG_OPTIMISTIC;
    }
    // A node born inside a live mark's identity scope inherits the mark
    // (the declaration walk could only cover nodes existing then).
    if (key !== $AFFECTS && affectsScopesLive()) inheritAffectsMarks(created, target.v, key);
    nodes[key] = node;
    target.nc++;
    markDescendants(target);
  }
  return node;
}

function sameLogicalSlot(target: StoreNextTarget, a: any, b: any): boolean {
  if (a === null || typeof a !== "object" || b === null || typeof b !== "object") return false;
  const map = target.fam?.map ?? storeNextLookup;
  const at = map.get(a);
  return at !== undefined && at === map.get(b);
}

export function getHasNode(
  target: StoreNextTarget,
  key: PropertyKey,
  present: boolean
): Signal<boolean> {
  const nodes = (target.h ??= Object.create(null));
  let node: Signal<boolean> | undefined = nodes[key];
  if (node === undefined) {
    const created: Signal<boolean> = (node = signal(
      present,
      {
        equals: isEqual,
        unobserved() {
          if ((created as any)._x?._affectsCount) return;
          if (target.h && target.h[key] === created) delete target.h[key];
        }
      },
      (target.fam?.node as any) ?? undefined
    ));
    created._config |= CONFIG_OWNED_WRITE;
    if (target.fam?.opt) {
      ext(created)._overrideValue = NOT_PENDING;
      created._config |= CONFIG_OPTIMISTIC;
    }
    if (affectsScopesLive()) inheritAffectsMarks(created as any, target.v, key);
    nodes[key] = node;
    markDescendants(target);
  }
  return node;
}

export function getKeySetNode(target: StoreNextTarget): Signal<number> {
  let k = target.k;
  if (k === null) {
    const created: Signal<number> = (k = signal(
      0,
      {
        equals: false,
        unobserved() {
          if (target.k === created) target.k = null;
        }
      },
      (target.fam?.node as any) ?? undefined
    ));
    created._config |= CONFIG_OWNED_WRITE;
    if (target.fam?.opt) {
      ext(created)._overrideValue = NOT_PENDING;
      created._config |= CONFIG_OPTIMISTIC;
    }
    target.k = k;
    markDescendants(target);
  }
  return k;
}

function getDeepNode(target: StoreNextTarget): Signal<number> {
  let dk = target.dk;
  if (dk === null) {
    const created: Signal<number> = (dk = signal(
      0,
      {
        equals: false,
        unobserved() {
          if (target.dk === created) target.dk = null;
        }
      },
      (target.fam?.node as any) ?? undefined
    ));
    created._config |= CONFIG_OWNED_WRITE;
    if (target.fam?.opt) {
      ext(created)._overrideValue = NOT_PENDING;
      created._config |= CONFIG_OPTIMISTIC;
    }
    if (affectsScopesLive()) inheritAffectsMarks(created as any, target.v, $TRACK);
    target.dk = dk;
    markDescendants(target);
  }
  return dk;
}

/** Deep-witness bump: any value/shape change on a record with a live deep()
 * subscriber notifies it. One null check when unused. */
export function bumpDeep(t: StoreNextTarget): void {
  if (t.dk !== null) setSignal(t.dk, 1 as any);
}

function markDescendants(target: StoreNextTarget): void {
  let t: StoreNextTarget | null = target;
  while (t && !t.d) {
    t.d = true;
    t = t.u;
  }
}

// ---------------------------------------------------------------------------
// pending backing + fold (the single mutation point)

/** target → committed backing at batch start (the fold diff's old side). */
const foldOlds = new Map<StoreNextTarget, Record<PropertyKey, any>>();
let hookInstalled = false;

function cloneRaw(source: Record<PropertyKey, any>, t?: StoreNextTarget): Record<PropertyKey, any> {
  // Descriptor-preserving shallow clone (R29: installed getters stay live;
  // ruled 2026-08-17: frozen sources clone unfrozen — theirs stays frozen).
  // Data descriptors normalize to writable+configurable (the clone is OURS to
  // mutate — R51's "source-non-configurable is writable through the store");
  // enumerability and accessors are preserved. The scan doubles as the
  // accessor-flag detector (free — we're enumerating descriptors anyway).
  const descs = Object.getOwnPropertyDescriptors(source);
  for (const key of Reflect.ownKeys(descs)) {
    const d = (descs as any)[key];
    if (key === "length" && Array.isArray(source)) continue;
    d.configurable = true;
    if (!d.get && !d.set) d.writable = true;
    else if (t) t.a = true;
  }
  return Array.isArray(source)
    ? (Object.defineProperties([], descs) as any)
    : Object.create(Object.getPrototypeOf(source), descs);
}

/** One-time own-accessor scan (Annex-B probes, no descriptor allocation);
 * returns true when the container is plain data (overlay-safe). */
function scanAccessorsOnce(target: StoreNextTarget): boolean {
  const src = target.v;
  for (const key of Reflect.ownKeys(src)) {
    // Own keys shadow prototype accessors, so the lookups are exact here.
    if (lookupGetter.call(src, key) !== undefined || lookupSetter.call(src, key) !== undefined) {
      target.a = true;
      break;
    }
  }
  target.sc = true;
  return !target.a;
}

/** Downgrade a prototype-overlay pending backing to the clone path: builds
 * the real container (committed + overlay writes − deletes) that fold will
 * SWAP in as the committed backing, exactly as if the draft had started on
 * the clone path. Consumers that need a complete container (reconcile's
 * diff walks, drafts escaping into other storage) call this. */
export function materializePB(target: StoreNextTarget): void {
  if (!target.ovl) return;
  const proto = target.pb!;
  const clone = cloneRaw(target.v, target);
  for (const key of Reflect.ownKeys(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, key)!;
    if (d.get || d.set || !d.enumerable || !d.writable || !d.configurable)
      Object.defineProperty(clone, key, d);
    else (clone as any)[key] = d.value;
  }
  if (target.del !== null) {
    for (const key of target.del) delete (clone as any)[key];
    target.del = null;
  }
  const map = target.fam?.map ?? storeNextLookup;
  map.delete(proto);
  ownedRaw.add(clone);
  map.set(clone, target);
  target.pb = clone;
  target.ovl = false;
}

function ensurePB(target: StoreNextTarget): Record<PropertyKey, any> {
  let pb = target.pb;
  if (pb === null) {
    // Prototype-chain overlay (#3044): plain-data non-array containers
    // outside projection/optimistic families open drafts in O(1) — own keys
    // are the writes, reads fall through to committed. Everything else
    // (arrays: splice/length semantics; families: seeding/revert machinery;
    // accessor containers: live getters) keeps the descriptor clone.
    if (
      target.fam === null &&
      !Array.isArray(target.v) &&
      (target.sc ? !target.a : scanAccessorsOnce(target))
    ) {
      pb = target.pb = Object.create(target.v) as Record<PropertyKey, any>;
      target.ovl = true;
    } else pb = target.pb = cloneRaw(target.v, target);
    // Optimistic families: seed USER drafts from the OPTIMISTIC VIEW
    // (committed + active node overrides), so follow-up writes compose on
    // optimism instead of clobbering from base (#2951's compose half).
    // AUTHORITATIVE drafts (projection recompute / write-override landings)
    // seed from committed truth — seeding overrides there would fold a lane
    // value into the committed home ("authority wins at reveal" would break).
    if (target.fam?.opt && !projectionWriteActive && !getWriteOverride()) {
      const nodes = target.n;
      if (nodes !== null) {
        for (const key of Reflect.ownKeys(nodes)) {
          const node = nodes[key as any];
          if (hasActiveOverride(node)) pb[key as any] = unwrapOverride(node._x?._overrideValue);
        }
      }
      const has = target.h;
      if (has !== null) {
        for (const key of Reflect.ownKeys(has)) {
          const node = has[key as any];
          if (hasActiveOverride(node) && !unwrapOverride(node._x?._overrideValue))
            delete pb[key as any];
        }
      }
    }
    ownedRaw.add(pb);
    (target.fam?.map ?? storeNextLookup).set(pb, target);
    queueFold(target);
  }
  return pb;
}

/**
 * Adoption (2026-08-16c): the incoming object becomes the committed backing
 * IMMEDIATELY — reconcile is eagerly visible to every reader (shipped
 * contract; only its notifications batch), unlike setter writes which stay
 * pending until flush. Ownership resets (incoming is unowned/user data). Any
 * staged draft clone folds into the diff and is discarded — next is the
 * authoritative base (R21/R32).
 */
export function adoptPB(
  target: StoreNextTarget,
  incoming: Record<PropertyKey, any>,
  eager = false
): void {
  // Eager mode (plain-store adoption): the caller notifies inline after its
  // descent — no foldOlds queue/drain round trip (the reconcile diff IS the
  // fold diff; ~half of dbmon tick time was this duplication).
  if (!eager) {
    queueFold(target); // records the pre-batch old before we swap
    target.adopted = true;
  }
  target.pb = null;
  // Overlay and accessor-scan state describe the OUTGOING backing — a
  // swapped container must not inherit them: a stale `ovl` beside a nulled
  // pb crashes materializePB (unwrapValue consults ovl before the
  // null-coalesce), a stale `del` would read the adoptee's keys as deleted
  // in the next draft, and a stale plain-data verdict (`sc`/`a`) could
  // admit an accessor-bearing adoptee to the overlay path. Reset; the next
  // draft rescans once (#3044 audit follow-up).
  target.ovl = false;
  target.del = null;
  target.sc = false;
  target.a = false;
  target.v = incoming;
  target.ch = (incoming as any)[$TARGET] !== undefined;
  (target.fam?.map ?? storeNextLookup).set(incoming, target);
  if (__TEST__ && ingestedRaw && !ownedRaw.has(incoming)) ingestedRaw.add(incoming);
}

function queueFold(target: StoreNextTarget): void {
  if (foldOlds.has(target)) return;
  if (foldOlds.size === 0) {
    if (!hookInstalled) {
      hookInstalled = true;
      setStoreCommitHook(drainFolds);
    }
    schedule(); // once per batch — drain clears the map
  }
  foldOlds.set(target, target.v);
}

/** Committed-time privatization for parent-chain slot updates (path copying). */
function privatizeCommitted(target: StoreNextTarget): void {
  if (ownedRaw.has(target.v)) return;
  const clone = cloneRaw(target.v, target);
  ownedRaw.add(clone);
  storeNextLookup.set(clone, target);
  target.v = clone;
  target.ch = false;
  if (target.u) {
    privatizeCommitted(target.u);
    devAssertNeverUserMutation(target.u.v);
    target.u.v[target.pk!] = target.v;
  }
}

function drainFolds(): void {
  if (foldOlds.size === 0) return;
  const entries = [...foldOlds];
  foldOlds.clear();
  for (const [t, old] of entries) {
    if (t.pb !== null) {
      // Setter path: nodes were setSignal'd at setter exit (write-time
      // notification — transitions/holds ride core machinery). Commit the
      // backing only for keys whose nodes have committed; a still-pending
      // node (transition-held) re-queues the target for the settling flush.
      let held = false;
      const pb = t.pb;
      const nodes = t.n;
      if (nodes !== null) {
        for (const key of Reflect.ownKeys(nodes)) {
          const node = nodes[key as any];
          if (node._pendingValue !== NOT_PENDING) {
            held = true;
            break;
          }
        }
      }
      if (held) {
        foldOlds.set(t, old); // re-queue: commit happens when the hold settles
        continue;
      }
      if (t.ovl) {
        // Overlay flatten (#3044): apply this batch's writes onto an OWNED
        // committed backing in place — O(written), not O(container). The
        // backing keeps its identity, so the `t.v === old` gate below skips
        // path copying (the parent slot already points here) and the
        // adopted-notify (setter notifications happened at write time).
        // Unowned backings privatize first (clone once, parents re-slotted)
        // — the never-mutate-user-data contract holds.
        privatizeCommitted(t);
        const v = t.v;
        for (const key of Reflect.ownKeys(pb)) {
          const d = Object.getOwnPropertyDescriptor(pb, key)!;
          if (d.get || d.set || !d.enumerable || !d.writable || !d.configurable)
            Object.defineProperty(v, key, d);
          else (v as any)[key] = d.value;
        }
        if (t.del !== null) {
          for (const key of t.del) delete (v as any)[key];
          t.del = null;
        }
        (t.fam?.map ?? storeNextLookup).delete(pb);
        t.pb = null;
        t.ovl = false;
      } else {
        t.v = pb;
        t.ch = false; // pb is always a plain clone
        t.pb = null;
      }
    }
    if (t.v === old) continue; // adopted then re-adopted back, or no-op
    // Path copying (CAS: see the eager-fold twin above).
    if (t.u && t.u.v[t.pk!] === old) {
      privatizeCommitted(t.u);
      devAssertNeverUserMutation(t.u.v);
      t.u.v[t.pk!] = t.v;
    }
    if (t.adopted) {
      t.adopted = false;
      notifyFold(t, old, t.v);
    }
  }
}

/**
 * Setter-exit notification (write channel): diff the draft's pending backing
 * against committed and setSignal every changed OBSERVED key — write-time
 * notification with commit deferred to node commit, so transition holds,
 * isPending, affects, and lane machinery ride the core natively (§3's
 * "pending home = the node when a node exists"). Unobserved keys stay in the
 * pending backing and fold directly at commit.
 */
function notifyWrites(t: StoreNextTarget): void {
  let pb = t.pb;
  if (pb === null) return;
  // Optimistic channel: user writes on an optimistic family become node-level
  // engine writes (armed nodes route setSignal through optimisticWrite) — the
  // committed backing is NEVER touched; the draft clone is discarded. Reverts,
  // per-transaction ownership, and flash-at-flush are all core-native.
  // Projection recompute writes (projectionWriteActive) and projection draft
  // writes (write-override, incl. post-await async landings) are
  // authoritative and take the plain channel below (they commit silently
  // under overrides per the engine's no-revert-stash contract).
  if (t.fam?.opt) {
    if (!projectionWriteActive && !getWriteOverride()) {
      optHooks!.notifyOptimisticWrites(t, pb);
      return;
    }
    // Authoritative path on an optimistic family: armed nodes must commit
    // silently (engine bypass) — without this, a landing's setSignals would
    // create lanes and block their own transition's settle.
    if (!projectionWriteActive) {
      setProjectionWriteActive(true);
      try {
        notifyWrites(t);
      } finally {
        setProjectionWriteActive(false);
      }
      return;
    }
  }
  const old = t.v;
  // Devtools mutation hook: full-key diff (dev-only cost) so unobserved
  // writes report too, matching the legacy set-trap hook. Overlay backings
  // materialize first so the diff walks a real container.
  if (__DEV__ && DEV.hooks.onStoreNodeUpdate) {
    if (t.ovl) materializePB(t);
    pb = t.pb!;
    for (const key of Reflect.ownKeys(pb)) {
      if (Array.isArray(pb) && key === "length") continue;
      const ov = old[key as any];
      const nv = pb[key as any];
      if (!isEqual(ov, nv)) DEV.hooks.onStoreNodeUpdate(t.px, key, nv, ov);
    }
    for (const key of Reflect.ownKeys(old)) {
      if (key in pb) continue;
      DEV.hooks.onStoreNodeUpdate(t.px, key, undefined, old[key as any]);
    }
  }
  const nodes = t.n;
  if (nodes !== null) {
    for (const key of Reflect.ownKeys(nodes)) {
      const node = nodes[key as any];
      // Per-key accessor handling: the node's cached flag plus ONE getter
      // probe on the incoming side (getters arriving via merge/adoption).
      // Setter-only props read as data (value undefined) so lookupSetter is
      // not consulted on this hot path; prototype getters never own nodes.
      if (
        (node as any).acc === true ||
        (hasOwn.call(pb, key) && lookupGetter.call(pb, key) !== undefined)
      ) {
        (node as any).acc = isOwnAccessor(pb, key);
        const od = Object.getOwnPropertyDescriptor(old, key);
        const nd = Object.getOwnPropertyDescriptor(pb, key);
        if ((od && (od.get || od.set)) || (nd && (nd.get || nd.set))) {
          if (od?.get !== nd?.get || od?.set !== nd?.set || od?.value !== nd?.value)
            setSignal(node, () => FORCE as any);
          continue;
        }
        if (!isEqual(od?.value, nd?.value)) setSignal(node, () => nd?.value);
        continue;
      }
      // No old-side pre-compare: t.v lags across multi-batch windows (a
      // projection recompute can run before the prior fold commits) — the
      // node's OWN current value is the true old side, and setSignal's
      // internal equality already checks exactly that.
      const nv = t.del !== null && t.del.has(key) ? undefined : pb[key as any];
      setSignal(node, () => nv);
    }
  }
  const has = t.h;
  if (has !== null) {
    for (const key of Reflect.ownKeys(has))
      setSignal(has[key as any], key in pb && !(t.del !== null && t.del.has(key)));
  }
  // Deep-witness (dk): setter writes must notify a deep() subscriber even on
  // keys with no node. O(pb keys) equality only when a witness exists.
  if (t.dk !== null) {
    if (t.del !== null && t.del.size !== 0) bumpDeep(t);
    else
      for (const key of Reflect.ownKeys(pb)) {
        const nv = pb[key as any];
        const ov = old[key as any];
        if (nv !== null && typeof nv === "object" ? !targetsEqual(ov, nv) : !isEqual(ov, nv)) {
          bumpDeep(t);
          break;
        }
      }
  }
  if (t.k !== null) {
    let changed: boolean;
    if (t.ovl) {
      // Overlay membership: only NEW own keys or deletes can change it.
      changed = t.del !== null && t.del.size !== 0;
      if (!changed) {
        for (const key of Reflect.ownKeys(pb)) {
          if (!hasOwn.call(old, key)) {
            changed = true;
            break;
          }
        }
      }
    } else {
      changed =
        Array.isArray(pb) && Array.isArray(old)
          ? arrayStructureChanged(old as any[], pb as any[])
          : membershipChanged(old, pb);
    }
    if (changed) setSignal(t.k, v => v + 1);
  }
  // Projection backing folds split by channel (two pinned contracts):
  // - sync-derive drafts (recompute body): NEVER eager — a downstream async
  //   hold can form LATER in the same flush and the leaf must stay at stale
  //   committed for context-free readers (spec-async "pends only the written
  //   leaf"). drainFolds commits when held-ness is knowable.
  // - post-await async LANDINGS (write-override per-op, microtask context —
  //   no enclosing flush can capture them): the data-level commit is
  //   IMMEDIATE — landed truth shows to untracked readers even while a
  //   downstream consumer's own async still holds the effect-level reveal
  //   (spec-async "verdicts never inherit consumers' in-flight state").
  if (t.fam !== null && t.pb !== null && getWriteOverride()) {
    const oldBacking = t.v;
    t.pb = null;
    t.v = pb;
    t.ch = false;
    if (t.u && t.u.v[t.pk!] === oldBacking) {
      privatizeCommitted(t.u);
      devAssertNeverUserMutation(t.u.v);
      t.u.v[t.pk!] = pb;
    }
  }
}

const FORCE: unique symbol = Symbol();

/** Same logical slot: both values resolve to one (re-pointed) child target —
 * adoption preserved identity, so the slot did not change (R9). */
export function targetsEqual(ov: any, nv: any): boolean {
  if (ov === null || typeof ov !== "object") return false;
  const ot = storeNextLookup.get(ov);
  return ot !== undefined && ot === storeNextLookup.get(nv);
}

function arrayStructureChanged(old: any[], neu: any[]): boolean {
  if (old.length !== neu.length) return true;
  for (let i = 0; i < neu.length; i++) {
    const ov = old[i];
    const nv = neu[i];
    if (!isEqual(ov, nv) && !targetsEqual(ov, nv)) return true;
  }
  return false;
}

function membershipChanged(old: Record<PropertyKey, any>, neu: Record<PropertyKey, any>): boolean {
  const nk = Reflect.ownKeys(neu);
  if (Reflect.ownKeys(old).length !== nk.length) return true;
  for (const key of nk) if (!(key in old)) return true;
  return false;
}

/**
 * The fold diff walks SUBSCRIPTION KEYS ONLY (legacy parity: `for key in
 * nodes`): nodes exist exactly where something tracked, so unobserved data
 * costs nothing here regardless of object size. Accessor safety rides the
 * sticky `t.a` flag — a node's key was necessarily read, so the get trap has
 * already seen whether it is an accessor.
 */
/** One node's fold notification (shared by notifyFold's walk and the fused
 * adoption walk): accessor-aware compare + equality/identity-gated setSignal. */
export function notifyKeyDiff(
  node: Signal<any>,
  key: PropertyKey,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>,
  // The incoming-side getter probe covers SETTER-channel arrivals (return-
  // form merges, defineProperty) — those flow through notifyWrites/
  // notifyFold, which probe. The RECONCILE channel (fused walk) passes
  // false: reconcile adopts immutable data by contract (R2a) and the pinned
  // getter-preservation tests are all setter-channel; skipping ~2 Annex-B
  // calls per key per tick is a measured dbmon win.
  probe = true
): void {
  if (
    (node as any).acc === true ||
    (probe && hasOwn.call(neu, key) && lookupGetter.call(neu, key) !== undefined)
  ) {
    (node as any).acc = isOwnAccessor(neu, key);
    const od = Object.getOwnPropertyDescriptor(old, key);
    const nd = Object.getOwnPropertyDescriptor(neu, key);
    if ((od && (od.get || od.set)) || (nd && (nd.get || nd.set))) {
      // Accessor involved: never invoke; force-notify on shape change so
      // subscribers re-read (and re-track) through the trap.
      if (od?.get !== nd?.get || od?.set !== nd?.set || od?.value !== nd?.value)
        setSignal(node, () => FORCE as any);
      return;
    }
    const ov = od?.value;
    const nv = nd?.value;
    if (!isEqual(ov, nv) && !targetsEqual(ov, nv))
      setSignal(node, typeof nv === "function" ? () => nv : (nv as any));
  } else {
    const ov = old[key as any];
    const nv = neu[key as any];
    // Direct value write when not a function (setSignal treats functions as
    // updaters) — saves a closure allocation per changed key on the fold
    // hot path.
    if (!isEqual(ov, nv) && !targetsEqual(ov, nv))
      setSignal(node, typeof nv === "function" ? () => nv : (nv as any));
  }
}

/** Accessor-flag probe for the fused walk's early-continue (accessor keys
 * can never identity-skip: their VALUE is the descriptor's product). */
export function hasAccessorFlag(node: Signal<any>): boolean {
  return (node as any).acc === true;
}

/** Fused-walk per-key notification with values already in hand: the caller
 * fetched both sides and handled the identity skip; this applies the
 * accessor branch (cached flag only — reconcile channel) or the plain
 * equality/identity-gated write. */
export function notifyKeyValue(
  node: Signal<any>,
  key: PropertyKey,
  ov: any,
  nv: any,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): void {
  if ((node as any).acc === true) {
    notifyKeyDiff(node, key, old, neu, false);
    return;
  }
  // The pre-compare is NOT redundant with the node's equals: setSignal parks
  // a pending value and registers with the batch before equality applies at
  // commit (RUL-1), so identity-preserved slots (adopted child containers —
  // every row's fresh `queries` array) must be gated out HERE or each one
  // pays the full write machinery every tick (measured: +0.5ms/tick dbmon).
  if (!isEqual(ov, nv) && !targetsEqual(ov, nv))
    setSignal(node, typeof nv === "function" ? () => nv : (nv as any));
}

/** Presence + membership halves of a fold notification (shared tail). */
export function notifyFoldTail(
  t: StoreNextTarget,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): void {
  const has = t.h;
  if (has !== null) {
    for (const key of Reflect.ownKeys(has)) setSignal(has[key as any], key in neu);
  }
  if (t.k !== null) {
    const changed =
      Array.isArray(neu) && Array.isArray(old)
        ? arrayStructureChanged(old as any[], neu as any[])
        : membershipChanged(old, neu);
    if (changed) setSignal(t.k, v => v + 1);
  }
}

export function notifyFold(
  t: StoreNextTarget,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): void {
  if (t.dk !== null && old !== neu) bumpDeep(t);
  // Optimistic targets: adoption notifications are authoritative landings —
  // bypass the engine (commit into _value; active overrides keep shadowing
  // until their transaction settles, per the no-revert-stash contract).
  if (t.fam?.opt && !projectionWriteActive) {
    setProjectionWriteActive(true);
    try {
      notifyFold(t, old, neu);
    } finally {
      setProjectionWriteActive(false);
    }
    return;
  }
  const nodes = t.n;
  if (nodes !== null) {
    for (const key of Reflect.ownKeys(nodes)) {
      notifyKeyDiff(nodes[key as any], key, old, neu);
    }
  }
  const has = t.h;
  if (has !== null) {
    for (const key of Reflect.ownKeys(has)) setSignal(has[key as any], key in neu);
  }
  if (t.k !== null) {
    // Key-set/$TRACK: objects notify on membership; arrays on any index or
    // length change (mapArray and iteration re-read values — R15).
    const changed =
      Array.isArray(neu) && Array.isArray(old)
        ? arrayStructureChanged(old as any[], neu as any[])
        : membershipChanged(old, neu);
    if (changed) setSignal(t.k, v => v + 1);
  }
}

// ---------------------------------------------------------------------------
// traps

/** >0 while inside a setter: writes allowed, reads are read-your-writes. */
let writing = 0;

/** Write scope keys (a family object or a plain store's root target): draft
 * semantics — write permission, read-your-writes, tracking suppression —
 * apply ONLY to targets under a scope being written. Reads of OTHER stores
 * inside a setter track normally (they are dependencies: a projection derive
 * reading another store must link it). */
let writeScopes: Set<any> | null = null;

function scopeKey(target: StoreNextTarget): any {
  if (target.fam !== null) return target.fam;
  let t = target;
  while (t.u !== null) t = t.u;
  return t;
}

function inDraft(target: StoreNextTarget): boolean {
  return writeScopes !== null && writeScopes.has(scopeKey(target));
}

/** Shallow serve rule (#2932): raw-marked data serves VERBATIM, but a
 * store-proxy slot value gets a boundary wrapper in THIS store's own family —
 * write isolation through derived chains (downstream writes must never land
 * upstream). markRawOne skips proxies for exactly this reason. */
function serveShallow(target: StoreNextTarget, key: PropertyKey, v: any): any {
  if (v !== null && typeof v === "object" && (v as any)[$TARGET] !== undefined)
    return draftServe(target, wrapNext(v, target, key as any));
  return v;
}

/** Draft reads extend write permission to reachable stores (legacy Writing
 * semantics: wrapping a child through a draft get admits it — cross-store
 * writes like `s.inner.a = 10` work when `inner` is another store's proxy). */
function draftServe(target: StoreNextTarget, proxy: any): any {
  if (writeScopes !== null && inDraft(target)) {
    const ct: StoreNextTarget | undefined = proxy?.[$TARGET];
    if (ct !== undefined && ct.v !== undefined) writeScopes.add(scopeKey(ct));
  }
  return proxy;
}

/** Targets written during the current (outermost) setter — notified at exit. */
const pendingNotify = new Set<StoreNextTarget>();

const UNSAFE_KEYS = new Set<PropertyKey>(["__proto__", "prototype", "constructor"]);

/** Mirror of core read()'s context rule: the OWNER context (not the tracking
 * observer) decides pending visibility, with Roots resolving to their parent
 * computed (#2687 — untracked reads inside mapArray Roots see in-flight
 * values mid-flush). CHILDREN_FORBIDDEN execution scopes (createTrackedEffect
 * / onSettled callbacks) get COMMITTED visibility (#3006), same as core. */
function inOwnerContext(): boolean {
  const c: any = getOwner();
  if (c === null) return false;
  const eff = c._root ? c._parentComputed : c;
  return eff != null && !(eff._config & CONFIG_CHILDREN_FORBIDDEN);
}

/** A pending fold is transition-held when any written node's parked value is
 * stamped by a live transition (a plain batch parking — the lazy-recompute
 * read case — has no transition stamp and serves fresh). */
function foldHeld(target: StoreNextTarget): boolean {
  const nodes = target.n;
  if (nodes === null) return false;
  for (const key of Reflect.ownKeys(nodes)) {
    const node: any = nodes[key as any];
    if (
      node._pendingValue !== NOT_PENDING &&
      node._transition != null &&
      node._transition._done !== true
    )
      return true;
  }
  return false;
}

function readSource(target: StoreNextTarget): Record<PropertyKey, any> {
  // Signal-parity visibility (core read(): owner-context reads serve
  // _pendingValue, context-free reads serve committed — effects recompute
  // BEFORE commitPendingNodes in the flush, so the pending view must be
  // servable). Drafts (setter window OR projection write-override) and
  // owner-context reads see the pending backing; context-free reads see
  // committed. Node reads apply the same rule, so both homes agree.
  if (
    target.pb !== null &&
    (inDraft(target) ||
      getWriteOverride() ||
      inOwnerContext() ||
      // A projection's pending backing is authoritative-elect: serve it to
      // context-free readers too UNLESS a transition is holding the node
      // commits (downstream async hold — stale committed is the contract).
      (target.fam !== null && !foldHeld(target)))
  )
    return target.pb;
  return target.v;
}

const hasOwn = Object.prototype.hasOwnProperty;
// Allocation-free own-accessor probe (replaces eager descriptor scans — the
// single biggest creation cost in the uibench profile): Annex-B lookups
// return the fn or undefined with no descriptor object. Own data properties
// shadow prototype accessors, so hasOwn + lookup is an exact own-check.
const lookupGetter = (Object.prototype as any).__lookupGetter__;
const lookupSetter = (Object.prototype as any).__lookupSetter__;
function isOwnAccessor(src: Record<PropertyKey, any>, key: PropertyKey): boolean {
  return (
    hasOwn.call(src, key) &&
    (lookupGetter.call(src, key) !== undefined || lookupSetter.call(src, key) !== undefined)
  );
}

/** Authoritative-write wrapper exported for the optimistic module: sets the
 * scheduler's projectionWriteActive through THIS module's binding (proven to
 * share the instance core reads — cross-module live-binding writes from other
 * store modules were observed not to propagate under the test transform). */
export function runAuthoritative<T>(fn: () => T): T {
  const was = projectionWriteActive;
  setProjectionWriteActive(true);
  try {
    return fn();
  } finally {
    setProjectionWriteActive(was);
  }
}

/** Active optimistic override on an armed node (armed slot idles at
 * NOT_PENDING; undefined = unarmed plain node). */
export function hasActiveOverride(node: Signal<any>): boolean {
  return node._x?._overrideValue !== undefined && node._x?._overrideValue !== NOT_PENDING;
}

/** Context-aware node view for reads outside tracking: active override >
 * held pending (owner context) > the BACKING value. Committed truth lives in
 * the backing (single-home rule, O6) — node `_value` is never served here,
 * so a lazy recompute's landing is immediately visible to the untracked
 * reader that forced it (backing commits eagerly; node values fold at flush).
 * FORCE sentinels never surface (they only bump subscribers of accessor
 * keys, which are served by the trap, not the node). */
function nodeValue(node: Signal<any>, backing: any): any {
  const v = hasActiveOverride(node)
    ? unwrapOverride(node._x?._overrideValue)
    : node._pendingValue !== NOT_PENDING && inOwnerContext()
      ? node._pendingValue
      : backing;
  return v === (FORCE as any) ? backing : v;
}

/** Serve an own data key: node-first when a node exists (pending visibility,
 * holds, lanes ride the node); backing otherwise. Chained backings (§7b: the
 * backing IS another store's proxy) serve the read-through value — the outer
 * node is linked only for adoption-swap notification, its value never
 * shadows the live chain. */
function serveDataKey(
  target: StoreNextTarget,
  key: PropertyKey,
  backingValue: any,
  src: Record<PropertyKey, any>,
  node?: Signal<any>
): any {
  const chained = target.ch && src === target.v;
  let v = backingValue;
  // §6: on optimistic arrays LENGTH IS A VIEW, not a node value — one home
  // (backing ± presence overrides) for both length and indices makes torn
  // iteration impossible (a length node's value rides different visibility
  // rails than index overrides mid-settle). The node still carries
  // subscriptions; its value is never served here.
  if (key === "length" && target.fam?.opt === true && !chained && Array.isArray(src)) {
    if (!inDraft(target)) {
      const node = target.n?.length;
      if (node !== undefined) {
        if (getObserver() !== null) readNode(node);
      } else if (getObserver() !== null) {
        readNode(getNode(target, key, backingValue));
      }
    }
    return (optHooks!.optimisticView(target, src) as any[]).length;
  }
  if (inDraft(target)) {
    // Optimistic drafts before their first write have no pending backing yet;
    // reads must still see the live optimistic view (compose, not clobber —
    // #2951). Once ensurePB runs, the seeded clone carries the view.
    if (target.fam?.opt && target.pb === null) {
      const node = target.n?.[key as any];
      if (node !== undefined && hasActiveOverride(node))
        v = unwrapOverride(node._x?._overrideValue);
    }
  } else {
    if (node !== undefined) {
      // §7b: a lane value on the outer node SHADOWS read-through — an active
      // override pierces the chained gate; otherwise chained backings always
      // serve the live inner value.
      if (getObserver() !== null) {
        // read()'s plain-signal fast path hoisted over the call (legacy trap
        // parity): READ_SLOW = a global read window or non-plain node.
        let nv = readNodeFast(node);
        if (nv === READ_SLOW) nv = readNode(node);
        if (!chained || hasActiveOverride(node)) v = nv === (FORCE as any) ? backingValue : nv;
      } else if (!chained || hasActiveOverride(node)) {
        v = nodeValue(node, backingValue);
      }
    } else if (getObserver() !== null) {
      readNode(getNode(target, key, backingValue));
    }
  }
  // Shallow stores serve data raw; store-proxy slots get boundary wrappers.
  if (target.s) return serveShallow(target, key, v);
  if (node !== undefined) {
    // Wrap cache (see getNode): only wrappables are ever cached, so a hit
    // skips isWrappable too — pointer-compare replaces both checks.
    if ((node as any).pxv === v && v !== undefined) return draftServe(target, (node as any).px);
    if (!isWrappable(v)) return v;
    const p = wrapNext(v, target, key as any);
    (node as any).px = p;
    (node as any).pxv = v;
    return draftServe(target, p);
  }
  if (!isWrappable(v)) return v;
  return draftServe(target, wrapNext(v, target, key as any));
}

/** §6c store-wide status gate for reads that DON'T flow through a node:
 * untracked/raw fallthrough must still throw while the derive is
 * uninitialized (seed invisibility, proj R23) or errored (memo parity).
 * TRACKED reads never call this — store nodes carry `_firewall`, so core
 * read() links the node and throws the firewall's error itself (the node
 * link is what wakes async-memo readers when the landing writes values;
 * the firewall link rides the same read). */
function firewallGate(target: StoreNextTarget): void {
  const fw: any = target.fam?.node;
  if (fw != null && fw._statusFlags & (STATUS_UNINITIALIZED | STATUS_ERROR)) readNode(fw);
}

const traps: ProxyHandler<StoreNextTarget> = {
  get(target, key, receiver) {
    // One typeof gates every brand-symbol compare off the hot string path
    // (four symbol comparisons per property read otherwise).
    if (typeof key !== "string") {
      if (key === $TARGET) return target;
      if (key === $PROXY) return receiver;
      // refresh()/isPending resolve the projection computed through $REFRESH.
      if (key === $REFRESH) return target.fam?.node ?? undefined;
      if (key === $TRACK) {
        if (pendingCheckActive) witnessAffectsMark(target as any, key);
        if (target.fam !== null && getObserver() === null && !inDraft(target)) firewallGate(target);
        if (!inDraft(target) && getObserver() !== null) {
          readNode(getKeySetNode(target));
          // Structural chaining (§7b, #2864 / core R21): a chained backing's
          // $TRACK reads through to the INNER store's key-set — structural
          // notifications land on the source's own node, never on this
          // wrapper view's.
          const srcT = readSource(target);
          if ((srcT as any)[$TARGET] !== undefined) (srcT as any)[$TRACK];
        }
        return undefined;
      }
      // user symbols fall through to the generic path
    }
    if (pendingCheckActive) witnessAffectsMark(target as any, key);
    if (target.fam !== null && getObserver() === null && !inDraft(target)) firewallGate(target);
    const src = readSource(target);
    // Overlay delete (#3044): a prototype overlay cannot shadow a delete, so
    // deleted keys are tracked aside and read as absent in the pending view.
    if (target.del !== null && src === target.pb && target.del.has(key)) {
      if (!inDraft(target) && getObserver() !== null) readNode(getNode(target, key, undefined));
      return undefined;
    }
    // Hot inline case: existing PLAIN node (non-accessor), unchained backing,
    // tracked read of a present data key — the dbmon/uibench effect re-read
    // shape. Skips serveDataKey's frame, the FORCE compare (only accessor
    // keys ever hold the sentinel), and isWrappable for primitives.
    if (target.ch === false && writeScopes === null) {
      const nodeH = target.n?.[key as any];
      if (nodeH !== undefined && (nodeH as any).acc !== true && getObserver() !== null) {
        let nv = readNodeFast(nodeH);
        if (nv === READ_SLOW) nv = readNode(nodeH);
        if (nv === null || typeof nv !== "object") return nv;
        if (target.s) return serveShallow(target, key, nv);
        if ((nodeH as any).pxv === nv) return (nodeH as any).px;
        if (isWrappable(nv)) {
          const p = wrapNext(nv, target, key);
          (nodeH as any).px = p;
          (nodeH as any).pxv = nv;
          return p;
        }
        return nv;
      }
    }
    // Dev strictRead: untracked store reads in labeled scopes (component
    // bodies, effect callbacks) warn — the value can never update the reader.
    if (
      __DEV__ &&
      strictRead &&
      !inDraft(target) &&
      typeof key === "string" &&
      getObserver() === null
    ) {
      // Safeguard parity with core read() (#2897): a component-body read of
      // a REFETCHING derived store escalates — the untracked reader can never
      // observe the in-flight update (strict-read matrix, opt R30–R34).
      if (((target.fam?.node as any)?._statusFlags ?? 0) & STATUS_PENDING)
        throwPendingUntrackedRead(strictRead, { nodeName: key });
      warnStrictReadUntracked(strictRead, {
        nodeName: key,
        data: { strictRead, property: key, source: "store" }
      });
    }
    // Accessor keys serve through Reflect.get with the PROXY receiver
    // (R20/R29: internal reads track; the node is linked for shape-change
    // notification but its value is never served). Accessor-ness comes from
    // the node's cached flag; the first TRACKED read (which creates the
    // node) probes once — untracked node-less reads take the plain path,
    // where a raw-receiver getter still returns correct committed values.
    // Tracking suppression is PER-TARGET (inDraft), never global: `writing`
    // counts every open setter anywhere, and a projection derive runs its
    // whole body inside one — a global gate silently swallowed EXTERNAL
    // absent-key/accessor subscriptions for every store read during any
    // derive, leaving nested projections permanently dependency-less when
    // their sources hadn't materialized yet (#3037).
    const node0 = target.n?.[key as any];
    {
      const acc =
        node0 !== undefined
          ? (node0 as any).acc === true
          : !inDraft(target) && getObserver() !== null && isOwnAccessor(src, key);
      if (acc) {
        if (!inDraft(target) && getObserver() !== null)
          readNode(node0 ?? getNode(target, key, undefined));
        const v = Reflect.get(src, key, receiver);
        if (target.s) return serveShallow(target, key, v);
        return isWrappable(v) ? draftServe(target, wrapNext(v, target, key)) : v;
      }
    }
    // Plain-data fast path: no descriptor allocation per read.
    // Inherited pollution keys are never served (core R30) — checked before
    // the proto-function branch can leak `constructor`. Interned-string
    // compares beat a Set hash on this per-read path. Overlay pending
    // backings chain to the committed backing, so "own in the view" means
    // own on either layer (ownInView) — a genuine prototype method is one
    // that is own on NEITHER.
    const viewOvl = target.ovl && src === target.pb;
    if (
      (key === "constructor" || key === "__proto__" || key === "prototype") &&
      !hasOwn.call(src, key) &&
      !(viewOvl && hasOwn.call(target.v, key))
    )
      return undefined;
    let v = (src as any)[key];
    if (
      v === undefined ? !hasOwn.call(src, key) && !(viewOvl && hasOwn.call(target.v, key)) : false
    ) {
      // Inherited: prototype getters/methods run with the proxy receiver.
      v = Reflect.get(src, key, receiver);
      if (typeof v === "function") return v; // proto methods untracked
      // Reading a currently-absent own key subscribes to it (R12) — for any
      // target OUTSIDE its own draft scope, even mid-setter (#3037, above).
      if (v === undefined && !inDraft(target)) {
        if (getObserver() !== null) readNode(getNode(target, key, undefined));
        const node = target.n?.[key];
        if (node) {
          const nv = nodeValue(node, undefined);
          if (target.s) return serveShallow(target, key, nv);
          return isWrappable(nv) ? draftServe(target, wrapNext(nv, target, key)) : nv;
        }
      } else if (v === undefined && inDraft(target) && target.fam?.opt && target.pb === null) {
        const node = target.n?.[key];
        if (node !== undefined && hasActiveOverride(node))
          v = unwrapOverride(node._x?._overrideValue);
      }
      if (target.s) return serveShallow(target, key, v);
      return isWrappable(v) ? draftServe(target, wrapNext(v, target, key)) : v;
    }
    if (
      typeof v === "function" &&
      !hasOwn.call(src, key) &&
      !(viewOvl && hasOwn.call(target.v, key))
    )
      return v; // proto method
    return serveDataKey(target, key, v, src, node0);
  },

  has(target, key) {
    if (key === $TARGET || key === $PROXY || key === $TRACK) return true;
    if (pendingCheckActive) witnessAffectsMark(target as any, key);
    if (target.fam !== null && getObserver() === null && !inDraft(target)) firewallGate(target);
    const src = readSource(target);
    let present = key in src;
    // Overlay deletes read as absent in the pending view (#3044).
    if (present && target.del !== null && src === target.pb && target.del.has(key)) present = false;
    if (!inDraft(target)) {
      if (getObserver() !== null) {
        const node = getHasNode(target, key, present);
        const nv = readNode(node);
        if (hasActiveOverride(node)) present = !!nv;
      } else {
        const node = target.h?.[key as any];
        if (node !== undefined && hasActiveOverride(node))
          present = !!unwrapOverride(node._x?._overrideValue);
      }
    } else if (target.fam?.opt && target.pb === null) {
      const node = target.h?.[key as any];
      if (node !== undefined && hasActiveOverride(node))
        present = !!unwrapOverride(node._x?._overrideValue);
    }
    return present;
  },

  ownKeys(target) {
    if (pendingCheckActive) witnessAffectsMark(target as any);
    if (target.fam !== null && getObserver() === null && !inDraft(target)) firewallGate(target);
    if (!inDraft(target) && getObserver() !== null) readNode(getKeySetNode(target));
    const src = readSource(target);
    let keys: (string | symbol)[];
    if (target.ovl && src === target.pb) {
      // Overlay merge (#3044): committed keys in their order, then this
      // batch's NEW keys, minus deletes.
      keys = Reflect.ownKeys(target.v);
      const del = target.del;
      if (del !== null && del.size !== 0) keys = keys.filter(key => !del.has(key));
      for (const key of Reflect.ownKeys(src)) {
        if (!hasOwn.call(target.v, key)) keys.push(key);
      }
    } else keys = Reflect.ownKeys(src);
    // Optimistic membership overlay: presence-node overrides add/remove keys
    // (per-transaction lifecycle rides the nodes — §6, FINDING-2's fix).
    // Draft reads before the first write overlay too (pb, once created, is
    // seeded with the view).
    if (target.fam?.opt && target.h !== null && (!inDraft(target) || target.pb === null)) {
      let set: Set<PropertyKey> | null = null;
      for (const key of Reflect.ownKeys(target.h)) {
        const node = target.h[key as any];
        if (!hasActiveOverride(node)) continue;
        set ??= new Set(keys);
        if (unwrapOverride(node._x?._overrideValue)) set.add(key);
        else set.delete(key);
      }
      if (set !== null) return [...set] as (string | symbol)[];
    }
    return keys;
  },

  getOwnPropertyDescriptor(target, key) {
    const srcD = readSource(target);
    let desc = Object.getOwnPropertyDescriptor(srcD, key);
    // Overlay (#3044): unwritten keys live on the committed backing;
    // deleted keys are absent from the pending view.
    if (target.ovl && srcD === target.pb) {
      if (target.del !== null && target.del.has(key)) return undefined;
      if (desc === undefined) desc = Object.getOwnPropertyDescriptor(target.v, key);
    }
    if (target.fam?.opt && !inDraft(target)) {
      const node = target.h?.[key as any];
      if (node !== undefined && hasActiveOverride(node)) {
        if (!unwrapOverride(node._x?._overrideValue)) return undefined; // opt delete
        if (desc === undefined) {
          const vn = target.n?.[key as any];
          return {
            value: vn !== undefined ? nodeValue(vn, undefined) : undefined,
            writable: true,
            enumerable: true,
            configurable: true
          };
        }
      }
    }
    if (desc === undefined) return undefined;
    // Array targets carry a real non-configurable `length` the proxy
    // invariant forces us to report faithfully; everything else reports
    // configurable via target indirection (core R51).
    if (!(key === "length" && Array.isArray(target))) desc.configurable = true;
    return desc;
  },

  set(target, key, value) {
    // Writes require the target's draft scope OR the projection write
    // override (post-await async draft writes arrive outside any window);
    // everything else is silently ignored (R23).
    const draft = inDraft(target);
    const override = !draft && getWriteOverride();
    if (!draft && !override) return true;
    if (key === "__proto__") return true; // pollution guard (core R30)
    // Unwrap BEFORE ensurePB: unwrapValue materializes a self-referencing
    // draft's overlay (replacing target.pb), so a pb local captured earlier
    // would be the abandoned overlay and the write would vanish.
    // Shallow slots store what was written VERBATIM — another store's proxy
    // passes through by reference (#2932; markRawOne skips proxies), while
    // deep stores unwrap to raw backings.
    const uv = target.s ? value : unwrapValue(value);
    const pb = ensurePB(target);
    pendingNotify.add(target);
    // Own data keys literally named "prototype"/"constructor" land as data —
    // defineProperty sidesteps a proto-chain setter named the same.
    if (UNSAFE_KEYS.has(key)) {
      Object.defineProperty(pb, key, {
        value: uv,
        writable: true,
        enumerable: true,
        configurable: true
      });
      if (target.del !== null) target.del.delete(key);
      return true;
    }
    // Overlay first-write DEFINES the own key: assignment through the proto
    // chain would reject on a non-writable committed property (the clone
    // path normalized descriptors for exactly this — R51 parity).
    if (target.ovl && !hasOwn.call(pb, key)) {
      Object.defineProperty(pb, key, {
        value: uv,
        writable: true,
        enumerable: true,
        configurable: true
      });
    } else pb[key as any] = uv;
    if (target.del !== null) target.del.delete(key);
    // Shallow ingest: written records are sticky raw-marked (one entity is
    // never both deep-wrapped and raw — R41/#2932, shared invariant).
    if (target.s && uv !== null && typeof uv === "object") markRawOne(uv);
    // Override-mode (post-await draft) writes have no setter exit — notify
    // per-op (setSignal equality-gates repeats).
    if (override) notifyWrites(target);
    return true;
  },

  defineProperty(target, key, desc) {
    const draft = inDraft(target);
    const override = !draft && getWriteOverride();
    if (!draft && !override) return true;
    if (key === "__proto__") return true;
    if (desc.get || desc.set) target.a = true;
    // Unwrap before ensurePB (see the set trap: self-reference materializes).
    if ("value" in desc) desc = { ...desc, value: unwrapValue(desc.value) };
    const pb = ensurePB(target);
    pendingNotify.add(target);
    Object.defineProperty(pb, key, desc);
    if (target.del !== null) target.del.delete(key);
    if (override) notifyWrites(target);
    return true;
  },

  deleteProperty(target, key) {
    const draft = inDraft(target);
    const override = !draft && getWriteOverride();
    if (!draft && !override) return true;
    const pb = ensurePB(target);
    pendingNotify.add(target);
    delete pb[key as any];
    // A prototype overlay cannot shadow a delete of a committed key —
    // record it aside (#3044); reads/has/ownKeys/commit consult the set.
    if (target.ovl && hasOwn.call(target.v, key)) (target.del ??= new Set()).add(key);
    if (override) notifyWrites(target);
    return true;
  }
};

// ---------------------------------------------------------------------------
// createStore

export type SetStoreNextFunction<T> = (fn: (draft: T) => T | void) => void;

/** Low-level setter primitive: opens write mode on a next proxy, runs `fn`,
 * emits write-time notifications at outermost exit, applies returned
 * replacements as adoptions. `guard=false` skips the owned-scope dev guard —
 * projection recomputes legitimately write from inside their computed. */
export function storeSetterNext<T>(proxy: T, fn: (draft: T) => T | void, guard = true): void {
  if (__DEV__ && guard) devGuardStoreSetterWrite();
  const target: StoreNextTarget = (proxy as any)[$TARGET];
  const prevScopes = writeScopes;
  writeScopes = new Set();
  writeScopes.add(scopeKey(target));
  writing++;
  let result: any;
  try {
    // No untrack: the writing flag already disables store-node linking
    // (draft reads never self-track, proj R2), while EXTERNAL reads (signals
    // inside a projection derive) must keep tracking — they are the derive's
    // dependencies.
    result = fn(proxy);
  } finally {
    writing--;
    writeScopes = prevScopes;
    // Outermost setter exit: emit write-time notifications (setSignal per
    // changed observed key) so transition holds and lanes engage now.
    if (writing === 0 && pendingNotify.size) {
      const touched = [...pendingNotify];
      pendingNotify.clear();
      for (const t of touched) notifyWrites(t);
    }
  }
  if (result !== undefined && result !== proxy && isWrappable(result)) {
    // Returned replacement: on an optimistic family (outside authoritative
    // writes) the replacement is itself an optimistic edit — diff it against
    // the visible view as engine writes (reverts at settle). Otherwise it is
    // an adoption of the incoming object (unowned).
    if (target.fam?.opt && !projectionWriteActive && !getWriteOverride()) {
      optHooks!.notifyOptimisticWrites(target, unwrapValue(result));
    } else {
      adoptPB(target, unwrapValue(result));
    }
  }
}

// Affects integration: the legacy affects machinery reads next targets
// structurally (aliased field names); only node CREATION dispatches here.
setNextAffectsNodeResolver((t: StoreNextTarget, key: PropertyKey) =>
  key === $AFFECTS
    ? (getNode(t, $AFFECTS, undefined) as any)
    : (getNode(t, key, (t.pb ?? t.v)[key as any]) as any)
);

export function createStoreNext<T extends Record<PropertyKey, any>>(
  init: T,
  shallow = false
): [T, SetStoreNextFunction<T>] {
  if (shallow && __DEV__) {
    // Never both deep-wrapped and raw (R41/R44): a value already tracked as
    // a DEEP store cannot be ingested shallow.
    const existing = storeNextLookup.get(init);
    if (existing !== undefined && !(existing as any).s)
      throw new Error("createStore({ shallow }): value is already tracked as a deep store");
    if ((init as any)[$TARGET])
      throw new Error("createStore({ shallow }): value is already a store proxy");
  }
  const proxy = wrapNext(init);
  if (shallow) {
    ((proxy as any)[$TARGET] as StoreNextTarget).s = true;
    markRawIngest(init);
  }
  if (__DEV__) registerGraph(proxy, getOwner());
  const setter: SetStoreNextFunction<T> = fn => storeSetterNext(proxy, fn);
  return [proxy, setter];
}

// ---------------------------------------------------------------------------
// snapshot (next targets): the backing IS the plain raw graph — zero copy.
// Sees pending (R27) by reading pb. Chained/owned-copy caching lands with the
// utilities increment; this covers the createStore-suite contract.

function isNextProxy(value: any): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as any)[$TARGET] !== undefined &&
    ((value as any)[$TARGET] as StoreNextTarget).px === value
  );
}

/** Tracking deep snapshot (`deep()` for next targets): subscribes to the
 * key-set and every property node at every reachable level, then returns the
 * plain view. Shared references and cycles handled via the visited set. */
export function deepNext<T>(value: T): T {
  const t0: StoreNextTarget | undefined = (value as any)?.[$TARGET];
  if (t0 === undefined || t0.px !== value) return value;
  const visited = new Set<object>();
  // One membership node + one deep-witness node PER RECORD (legacy $TRACK
  // parity): the walk stays O(records) in subscriptions instead of O(paths)
  // in per-key nodes, and it walks TARGETS directly — no per-child proxy
  // round-trip (wrapNext → proxy → $TARGET trap) on the re-walk every
  // effect run performs.
  const walkT = (t: StoreNextTarget): void => {
    const src = readSource(t);
    if (visited.has(src)) return;
    visited.add(src);
    readNode(getKeySetNode(t));
    readNode(getDeepNode(t));
    const map = t.fam?.map ?? storeNextLookup;
    for (const key of Reflect.ownKeys(src)) {
      const desc = Object.getOwnPropertyDescriptor(src, key);
      if (desc === undefined) continue;
      if (desc.get || desc.set) {
        t.a = true;
        continue; // accessors track through their own reads when invoked
      }
      const child = desc.value;
      if (child === null || typeof child !== "object") continue;
      // Stored proxies (chained slots) resolve through their own target;
      // raw children through the family map, created on first visit.
      let ct: StoreNextTarget | undefined = (child as any)[$TARGET] ?? map.get(child);
      if (ct === undefined) {
        if (!isWrappable(child)) continue;
        wrapNext(child, t, key);
        ct = map.get(child);
        if (ct === undefined) continue; // raw-marked: leaf by contract
      }
      walkT(ct);
    }
  };
  walkT(t0);
  return snapshotNext(value);
}

/**
 * Snapshot with per-object registration resolution (RUL-12 DAG ruling): every
 * reachable wrappable resolves through its target's CURRENT backing, so
 * privatized subtrees are seen through any parent path. Identity-preserving:
 * a subtree with no substitutions below returns its own object (zero copy for
 * settled, never-diverged graphs).
 */
export function snapshotNext<T>(value: T): T {
  const t: StoreNextTarget | undefined = (value as any)?.[$TARGET];
  return snapshotWalk(value, new Map(), t?.fam ?? null);
}

function snapshotWalk(value: any, seen: Map<object, any>, fam: StoreNextFamily | null): any {
  if (value === null || typeof value !== "object") return value;
  // Resolve through the registration: proxies AND raws map to their target's
  // current backing (stale raw pointers through other parents resolve here).
  // Loops for chained backings (§7b: a projection's backing can be another
  // store's proxy — snapshot unwraps to the base raw).
  let src = value;
  // Chained backings can pass through several targets; optimistic overrides
  // on OUTER targets shadow the chain (§7b), so collect every opt target
  // encountered and compose their views over the resolved base, innermost
  // outward.
  let optOwners: StoreNextTarget[] | null = null;
  for (;;) {
    let t: StoreNextTarget | undefined = src?.[$TARGET]?.v !== undefined ? src[$TARGET] : undefined;
    if (t === undefined && fam !== null) t = fam.map.get(src);
    if (t === undefined) t = storeNextLookup.get(src);
    if (t === undefined) break;
    if (t.fam !== null) fam = t.fam;
    if (t.fam?.opt === true) (optOwners ??= []).push(t);
    // Snapshot runs mid-flush (tracked memos execute before commit), so a
    // pending prototype overlay must present as a REAL merged container.
    if (t.ovl) materializePB(t);
    const backing = t.pb ?? t.v;
    if (backing === src) break;
    src = backing;
  }
  if (!isWrappable(src)) return src;
  // Optimistic families: compose the visible view; a composed view is a fresh
  // object and snapshots via the owned/copy path (pinned `not.toBe` identity).
  if (optOwners !== null) {
    let view: any = src;
    for (let i = optOwners.length - 1; i >= 0; i--)
      view = optHooks!.optimisticView(optOwners[i], view);
    if (view !== src) {
      const cachedView = seen.get(src);
      if (cachedView !== undefined) return cachedView;
      const isArr = Array.isArray(view);
      const copy: any = isArr ? [] : Object.create(Object.getPrototypeOf(view));
      seen.set(src, copy);
      for (const key of Reflect.ownKeys(view)) {
        if (isArr && key === "length") continue;
        const cv = (view as any)[key];
        copy[key] = cv !== null && typeof cv === "object" ? snapshotWalk(cv, seen, fam) : cv;
      }
      if (isArr) copy.length = (view as any[]).length;
      return copy;
    }
  }
  const cached = seen.get(src);
  if (cached !== undefined) return cached;

  // OWNED (written) subtrees snapshot as copies (§7b: identity is only for
  // subtrees "unmodified relative to source"): non-enumerable symbols are
  // excluded (recon-snap R29), and the copy registers BEFORE descent so
  // cycles keep identity (FINDING-3).
  if (ownedRaw.has(src)) {
    const isArr = Array.isArray(src);
    const copy: any = isArr ? [] : Object.create(Object.getPrototypeOf(src));
    seen.set(src, copy);
    for (const key of Reflect.ownKeys(src)) {
      if (isArr && key === "length") continue;
      const desc = Object.getOwnPropertyDescriptor(src, key)!;
      if (typeof key === "symbol" && !desc.enumerable) continue;
      if (desc.get || desc.set) {
        Object.defineProperty(copy, key, desc);
        continue;
      }
      const cv = desc.value;
      const walked = cv !== null && typeof cv === "object" ? snapshotWalk(cv, seen, fam) : cv;
      if (desc.enumerable && desc.writable && desc.configurable) copy[key] = walked;
      else Object.defineProperty(copy, key, { ...desc, value: walked });
    }
    if (isArr && copy.length !== (src as any[]).length) copy.length = (src as any[]).length;
    return copy;
  }

  // UNOWNED (shared/user) subtrees keep identity unless a descendant
  // substituted; copy-on-substitution preserves the documented CoW contract.
  seen.set(src, src);
  let copy: any = null;
  for (const key of Reflect.ownKeys(src)) {
    const desc = Object.getOwnPropertyDescriptor(src, key);
    if (!desc || desc.get || desc.set) continue;
    const cv = desc.value;
    if (cv === null || typeof cv !== "object") continue;
    const walked = snapshotWalk(cv, seen, fam);
    if (walked !== cv) {
      if (copy === null) {
        copy = Array.isArray(src)
          ? [...(src as any[])]
          : Object.create(Object.getPrototypeOf(src), Object.getOwnPropertyDescriptors(src));
        seen.set(src, copy);
      }
      copy[key] = walked;
    }
  }
  return copy ?? src;
}
