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
  CONFIG_AUTHORITATIVE_READ,
  CONFIG_HELD_TRUTH,
  CONFIG_OPTIMISTIC
} from "../../core/constants.js";
import {
  context,
  devGuardStoreSetterWrite,
  isEqual,
  latestReadActive,
  prepareComputed,
  read as readNode,
  READ_SLOW,
  readNodeFast,
  setLatestReadActive,
  setSignal,
  signal,
  untrack,
  ext
} from "../../core/core.js";
import {
  activeTransition,
  currentTransition,
  globalQueue,
  insertSubs,
  type Transition
} from "../../core/scheduler.js";
import { getObserver, getOwner } from "../../core/owner.js";
import {
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
  type DeepNode,
  devAssertNeverUserMutation,
  ingestedRaw,
  markDescendants,
  ownedRaw,
  storeNextLookup,
  type StoreNextFamily,
  type StoreNextTarget,
  type PatchChannel,
  optHooks
} from "./target.js";
// Patch-channel emission rides installed hooks (patch-hooks.ts) so the
// channel tree-shakes out of apps that never register a patch consumer.
// Every call is `t.pc`-guarded — a target only acquires `pc` through
// patch.js registration, which installs the hooks first.
import { patchHooks, rowHooks, installWrapRecordHook, wrapRecordHook } from "./patch-hooks.js";

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
 * the array exotic class for `Array.isArray(proxy)`.
 *
 * ARRAY SHAPE RULE: arrays normalize their named properties to dictionary
 * mode as the count grows (V8 13.x: counts ≡ 0 mod 3 from 18 up), so the
 * target's named field count is capped at 20 — write-side patch-channel
 * state lives inside the single `pc` extension (see target.ts), never as
 * new named fields here. */
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
  this.pc = undefined;
  this.hv = undefined;
  this.ht = undefined;
}
TargetShape.prototype = Object.prototype;

/** Lazily allocate the patch-channel extension (one literal shape). */
export function pcOf(t: StoreNextTarget): PatchChannel {
  return (
    t.pc ??
    (t.pc = {
      sp: null,
      p: null,
      ro: null,
      wk: null,
      dn: null,
      de: undefined,
      dv: 0,
      bc: 0,
      np: undefined,
      npb: 0,
      dmq: false,
      bt: null,
      bo: null,
      ak: null,
      dp: null,
      ks: false,
      akAll: false,
      mlc: 0,
      t
    })
  );
}

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
  t.pc = null;
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
  t.hv = null;
  t.ht = null;
  if (wrapRecordHook === null) installWrapRecordHook(wrapNext);
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

/** Scanned plainness for patch admission (patchableRaw): runs the one-time
 * accessor scan if it hasn't happened yet — the sticky `a` flag alone is not
 * trustworthy before a scan (it starts false and is discovered lazily).
 * Prototype gate first (re-audit 7, P1-2b): class instances are wrappable
 * store input whose accessors live on the PROTOTYPE — own-key scans never
 * see them, so non-plain prototypes reject patch admission wholesale (their
 * records keep tracked-effect semantics). */
export function targetIsPlain(target: StoreNextTarget): boolean {
  return isPlainProto(target.v) && (target.sc ? !target.a : scanAccessorsOnce(target));
}

/** Adoption-seam demotion gate, PROD-SOUND at bounded cost (re-audit 6):
 * probes ONLY the keys the record's compiled bodies actually read.
 * STATELESS against the emission's actual `next` object (re-audit 7,
 * P1-2a): sticky scan flags describe whatever backing was scanned last —
 * at adoption seams the object the bodies will read is the INCOMING one
 * (in setter drafts it is not even target.v yet), so the probe takes it
 * explicitly. Unrecorded channels (registered under hydration, never yet
 * applied) get a full fresh scan of the same object. */
export function targetKeysPlain(target: StoreNextTarget, next: Record<PropertyKey, any>): boolean {
  if (!isPlainProto(next)) return false;
  // akAll (size pass): a manifest-less consumer's reads are unknowable —
  // the union is poisoned and every probe FULL-SCANS (replaces the
  // drain-side recording proxy; compiled output always ships manifests).
  const ak = target.pc !== null && target.pc.akAll !== true ? target.pc.ak : null;
  if (ak === null) {
    for (const key of Reflect.ownKeys(next)) {
      if (lookupGetter.call(next, key) !== undefined || lookupSetter.call(next, key) !== undefined)
        return false;
    }
    return true;
  }
  for (let i = 0; i < ak.length; i++)
    if (lookupGetter.call(next, ak[i]) !== undefined) return false;
  const dp = target.pc !== null ? target.pc.dp : null;
  return dp === null || deepPathsPlain(dp, next, target);
}

/** Flat-key alias currency (round 10.6, P1): a manifest ROOT key whose
 * value is a RAW object must still be the CURRENT backing of its target —
 * `["right"]` reads the object itself, so a stale alias slot (the target
 * adopted a different backing; only the canonical parent chain was
 * path-copied) would hand the body the outgoing state with no pending
 * delivery to correct it. Deep paths get the same probe inside
 * deepPathsPlain; this covers the `dp === null` direct-object manifests.
 * Primitive values skip on a typeof; proxies are always current. */
export function rootKeysCurrent(
  t: StoreNextTarget,
  view: any,
  keys: PropertyKey[] | null
): boolean {
  if (view === null || typeof view !== "object") return true;
  const map = t.fam?.map ?? storeNextLookup;
  const ks = keys ?? Reflect.ownKeys(view); // null = full scan (akAll channels)
  for (let i = 0; i < ks.length; i++) {
    const v = (view as any)[ks[i]];
    if (v !== null && typeof v === "object" && (v as any)[$TARGET] === undefined) {
      const ct = map.get(v);
      if (ct !== undefined && (ct.pb ?? ct.v) !== v) return false;
    }
  }
  return true;
}

/** Walk the manifested deep-path PREFIX TREE through `next`, probing every
 * step for accessors and plain prototypes — shared prefixes probe exactly
 * once. A branch that leaves objects stops probing (the body's own read
 * would fault/short there, not hit a getter). Steps landing on store
 * proxies probe the raw backing. Root nodes skip their own getter probe —
 * `ak` (probed by the caller against the record) covers first segments.
 * With `t` given, interior RAW steps are also CURRENCY-probed (round 10.5,
 * F2): a raw child whose target has since adopted a different backing is a
 * stale alias path — eager path-copying repairs the canonical parent
 * chain, but a second parent sharing the same raw keeps the old slot, and
 * a body reading through it would render the outgoing state. Diverged =
 * not plain = decline (classic reads through the proxy and stays right). */
export function deepPathsPlain(dp: DeepNode[], next: any, t?: StoreNextTarget): boolean {
  const map = t !== undefined ? (t.fam?.map ?? storeNextLookup) : null;
  for (let i = 0; i < dp.length; i++) {
    if (!deepNodePlain(dp[i], next, true, map)) return false;
  }
  return true;
}

function deepNodePlain(
  node: DeepNode,
  parent: any,
  rootProbed: boolean,
  map: { get(k: object): StoreNextTarget | undefined } | null
): boolean {
  if (!rootProbed && lookupGetter.call(parent, node.k) !== undefined) return false;
  const children = node.c;
  if (children === null) return true; // leaf: the key probe was the work
  let o: any = parent[node.k];
  // FUNCTIONS are accessor carriers too (re-audit 9, P1-8) — and their
  // prototype is never plain, so descending demotes them conservatively.
  if (o === null || (typeof o !== "object" && typeof o !== "function")) return true;
  const inner: StoreNextTarget | undefined = o[$TARGET];
  if (inner !== undefined) o = inner.pb ?? inner.v;
  else if (map !== null) {
    const ct = map.get(o);
    if (ct !== undefined && (ct.pb ?? ct.v) !== o) return false; // stale alias slot
  }
  if (!isPlainProto(o)) return false;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // Leaves inline (they dominate real manifests — dbmon is 10 leaves per
    // 6 interior nodes; the recursion frames were ~20% of the probe).
    if (child.c === null) {
      if (lookupGetter.call(o, child.k) !== undefined) return false;
    } else if (!deepNodePlain(child, o, false, map)) return false;
  }
  return true;
}

/** Patch-admission prototype gate. Distinct from the overlay path's own-key
 * scan (`scanAccessorsOnce`): overlays remain VALID over class prototypes
 * (reads fall through the chain), so `a` keeps meaning own accessors only. */
function isPlainProto(o: object): boolean {
  const p = Reflect.getPrototypeOf(o);
  return p === Object.prototype || p === Array.prototype || p === null;
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
  // Truth-staged backing hand-off (#3164 fold): a TENTATIVE draft opening on
  // a target whose pending backing is truth-staged (a landing folded into a
  // retaining transaction — it carries a foldBatches stamp) must not share
  // the container. Tentative writes would pollute staged truth, and the
  // tentative discard (notifyOptimisticWrites nulls pb) would destroy the
  // landing. Park the staged backing and open a fresh draft seeded from the
  // optimistic view below; the tentative discard restores it. The
  // tentativePBs guard scopes this to draft OPEN: the draft's own backing
  // (foldBatches-stamped by its first write when an action's transition is
  // ambient) must not be parked by its own later writes.
  if (
    pb !== null &&
    !tentativePBs.has(pb) &&
    target.fam?.opt === true &&
    !projectionWriteActive &&
    !getWriteOverride() &&
    foldBatches.has(target)
  ) {
    stagedTruthPB.set(target, pb);
    pb = target.pb = null;
  }
  if (activeTransition !== null) foldBatches.set(target, activeTransition);
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
      tentativePBs.add(pb);
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

/** Sentinel holder for `t.ht`: a latest()-pull staged this adoption outside
 * any transition — the hold lasts until the fold commit (drainFolds). */
const PLAIN_HOLD: unique symbol = Symbol("plainHold");

/** True while a latest() read is pulling the projection computed up to date
 * (see the get trap): adoptions landing during the pull are speculative
 * against the un-flushed batch and stage a held view. (Not injectable — the
 * derived createStore overload retains projection machinery in every store
 * bundle, see treeshake.test.ts.) */
let latestPullActive = false;

/** Resolve the held committed view (#3074): answers the masked old backing
 * while the hold is live, and lazily clears a hold whose transition has
 * committed (transitions merge — resolve through currentTransition, same as
 * foldHeld's node stamps). */
export function heldMaskView(t: StoreNextTarget): Record<PropertyKey, any> | null {
  const ht = t.ht;
  if (ht === null) return null;
  if (ht !== PLAIN_HOLD && currentTransition(ht)?._done === true) return (t.ht = t.hv = null);
  return t.hv;
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
    // #3074/#3075: a projection recompute deriving from uncommitted inputs
    // swaps the backing SPECULATIVELY — committed-visibility readers must
    // keep the pre-hold view until the hold resolves (a source held by a
    // live transition, or a latest()-pull ahead of the flush). Post-await
    // landings (write-override) stay immediately visible — landed truth —
    // and clear any hold; optimistic families ride the lane machinery.
    if (target.fam?.opt !== true) {
      if (getWriteOverride()) {
        target.ht = target.hv = null;
      } else if (activeTransition !== null || latestPullActive) {
        if (heldMaskView(target) === null) target.hv = target.v;
        target.ht = activeTransition ?? PLAIN_HOLD;
      }
    }
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
  if (target.pc !== null) target.pc.wk = null; // adoption supersedes staged trap writes
  const old = target.v;
  target.v = incoming;
  target.ch = (incoming as any)[$TARGET] !== undefined;
  (target.fam?.map ?? storeNextLookup).set(incoming, target);
  // Eager path copying (round 10, P1-1): a child-subject adoption is
  // immediately visible to every reader — including a LATER mount reading
  // the ANCESTOR's committed raw. The fold drain path-copies for queued
  // adoptions; the eager walk (which skips the queue by design) must do
  // the same, or the ancestor's raw slot serves the outgoing backing with
  // no pending delivery to correct it.
  if (eager && target.u !== null && target.u.v[target.pk!] === old) {
    privatizeCommitted(target.u);
    devAssertNeverUserMutation(target.u.v);
    target.u.v[target.pk!] = incoming;
  }
  if (__TEST__ && ingestedRaw && !ownedRaw.has(incoming)) ingestedRaw.add(incoming);
}

/** Sentinel for `t.wk`: the written-keys bound is unusable this batch (an
 * array length write implicitly deleted indices) — consumers full-scan. */
const WK_ALL: Set<PropertyKey> = new Set();

const plainProto = (o: object): boolean => {
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === Array.prototype || p === null;
};

function queueFold(target: StoreNextTarget): void {
  if (foldOlds.has(target)) return;
  if (!hookInstalled) {
    hookInstalled = true;
    setStoreCommitHook(drainFolds);
  }
  // Always arm — "map non-empty ⇒ drain scheduled" is NOT an invariant: a
  // held re-queue, or an incomplete-transition flush (which skips
  // commitPendingNodes entirely), leaves entries behind after `scheduled`
  // was consumed. A size-gated arm then strands every LATER fold — queued
  // silently, never drained, committed base frozen at stale state while its
  // nodes commit (#3089). schedule() early-returns when already armed.
  schedule();
  foldOlds.set(target, target.v);
}

/** Fold write-attribution (#3089): a draft written while a transition is
 * active belongs to that transition — its fold must not commit before the
 * transition settles. Observed keys already defer through the held check in
 * drainFolds (their nodes carry _pendingValue); this write-time stamp is the
 * equivalent hold for UNOBSERVED keys, which have no node to consult.
 * Refreshed on every write; resolved through currentTransition at drain
 * (transitions merge — same rule as heldMaskView). */
const foldBatches = new WeakMap<StoreNextTarget, Transition>();

/** Parked truth-staged pending backings (#3164 fold): a tentative draft that
 * opens while a folded landing's backing is live moves the staged container
 * here (see ensurePB); the tentative discard in notifyOptimisticWrites
 * restores it in place of the usual null. */
export const stagedTruthPB = new WeakMap<StoreNextTarget, Record<PropertyKey, any>>();

/** Backings opened by TENTATIVE drafts (optimistic user setters): ensurePB's
 * truth-park must not fire against the draft's own container on its second
 * and later writes (the first write stamps foldBatches whenever an action's
 * transition is ambient). Entries die with their draft — tentative backings
 * are consumed at setter exit. */
const tentativePBs = new WeakSet<object>();

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
    // A latest()-pull staging holds only until the fold commit: this flush
    // is committing the batch the pull ran ahead of. Transition holds stay —
    // they clear when their transition is done (heldMaskView).
    if (t.ht === PLAIN_HOLD) t.ht = t.hv = null;
    // Eager (write-override) family folds swap pb -> v at notifyWrites'
    // tail: by the time this drain runs they carry no pb, and their
    // structural ops must emit at the fold-commit site below (the clone
    // branch never sees them). Re-audit blocker 4.
    const foldedEager = t.pb === null;
    if (t.pb !== null) {
      // #3089: a fold written under a still-running transition defers to
      // that transition's settle (the write-time stamp covers unobserved
      // keys; observed keys also hit the pending-node held check below).
      const fb = foldBatches.get(t);
      if (fb !== undefined) {
        if (currentTransition(fb)._done === false) {
          foldOlds.set(t, old);
          continue;
        }
        foldBatches.delete(t);
      }
      // Setter path: nodes were setSignal'd at setter exit (write-time
      // notification — transitions/holds ride core machinery). Commit the
      // backing only for keys whose nodes have committed; a still-pending
      // node (transition-held) re-queues the target for the settling flush.
      let held = false;
      const pb = t.pb;
      const nodes = t.n;
      if (nodes !== null) {
        // Only written keys can hold (their nodes took the setSignal); the
        // wk bound keeps this O(written) — see notifyWrites. Same fallback
        // rules as the notify (WK_ALL / accessors / non-plain prototypes).
        const wkh = t.pc !== null ? t.pc.wk : null;
        const keys: Iterable<PropertyKey> =
          wkh === null ||
          wkh === WK_ALL ||
          t.a === true ||
          // Overlay pbs chain to the COMMITTED object (#3044) — plainness is
          // the committed container's prototype, not the overlay's.
          !plainProto(t.ovl ? (t.v as object) : pb)
            ? Reflect.ownKeys(nodes)
            : wkh;
        for (const key of keys) {
          const node = nodes[key as any];
          if (node !== undefined && node._pendingValue !== NOT_PENDING) {
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
        // Reference baselines clone BEFORE the in-place merge (node
        // delivery — the queue's clonePrev moment).
        if (t.pc !== null && patchHooks !== null) patchHooks.prepareInPlaceFold(t);
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
        // Patch bump AT THE MERGE (node delivery): overlay flattens preserve
        // identity, so the `t.v === old` gate below skips every downstream
        // emission — this is the one moment in-place folds are visible.
        // Post-merge, so deliveries read committed state (write-time bumps
        // raced transition settles).
        if (t.pc !== null && patchHooks !== null && (t.pc.p !== null || t.pc.dn !== null)) {
          if (targetKeysPlain(t, t.v)) patchHooks.emitPatch(t, t.v, old);
          else patchHooks.demoteToEffects(t);
        } else if (t.pc !== null && patchHooks !== null) {
          patchHooks.emitPatchAncestors(t);
        }
        if (t.pc !== null) t.pc.wk = null; // written-keys window closes with the fold commit
      } else {
        // Setter-channel structural ops: a fold that changes an array's shape
        // (push/splice/permutation through the setter — the reconcile walk
        // never queues here) is a structural visibility transition for any
        // registered list driver. Identity-keyed; aligned folds emit nothing.
        // Family targets defer to their own adoption emission (fam reconcile).
        // Arrays always fold on this clone branch (overlay is non-array only).
        // Family setter drafts (writable projection push/splice through the
        // masked setter) fold on this branch too and the fold IS their
        // visibility moment — emit unless the structure already rode another
        // channel: adoption folds (reconcile walk emitted ops) and
        // optimistic families (lane-timed override channel). Re-audit
        // blocker 4.
        if (
          t.pc !== null &&
          t.pc.ro !== null &&
          !t.adopted &&
          t.fam?.opt !== true &&
          Array.isArray(pb) &&
          Array.isArray(t.v)
        )
          rowHooks!.emitSetterRowOps(t, t.v as any[], pb as any[]);
        t.v = pb;
        t.ch = false; // pb is always a plain clone
        t.pb = null;
        if (t.pc !== null) t.pc.wk = null; // written-keys window closes with the fold commit
      }
    }
    if (t.v === old) {
      // A no-op adoption (A -> B -> A before flush) still consumed its walk:
      // clear the flag or every later setter row-op gate (!t.adopted) stays
      // failed and a driven family list freezes (re-audit 5, P1-1).
      t.adopted = false;
      continue;
    }
    // Patch channel (fold-commit site): family targets emit HERE — the fold
    // IS their visibility moment (held folds re-queued above emit when they
    // actually commit) — and so do PLAIN fold-adopted targets (setter-
    // returned root replacements, chained-store swaps: adoptions WITHOUT a
    // reconcile walk, so no walk-site emission ever happened — re-audit 2,
    // P1-2). Plain eager targets emitted at their walk/setter sites already.
    if (t.pc !== null && (t.fam !== null || t.adopted)) {
      // Structural ops for folds whose structure rode no other channel:
      // eager-folded family SETTER drafts (write-override swaps pb -> v at
      // notifyWrites' tail — the clone branch never sees them; adoption
      // folds re-emitting would double the walk's ops) and PLAIN fold
      // adoptions (no walk at all). Optimistic families ride the override
      // channel (lane-timed ops + revert RESYNC) — never re-emit here.
      if (
        t.pc.ro !== null &&
        t.fam?.opt !== true &&
        (t.fam !== null ? foldedEager && !t.adopted : t.adopted) &&
        Array.isArray(t.v) &&
        Array.isArray(old)
      )
        rowHooks!.emitSetterRowOps(t, old as any[], t.v as any[]);
      if (t.pc.p !== null || t.pc.dn !== null) {
        // Accessor demotion at the fold-commit seam: prod-sound accessed-key
        // probes against the JUST-COMMITTED backing (see targetKeysPlain —
        // re-audit 6 reversed the dev-only trade; re-audit 7 made the probe
        // stateless against the emission object).
        if (targetKeysPlain(t, t.v)) patchHooks!.emitPatchLocal(t, t.v, old);
        else patchHooks!.demoteToEffects(t);
      }
    } else if (t.pc !== null && patchHooks !== null) {
      // PLAIN setter folds (node delivery): the value bump moved here from
      // the setter site — post-swap, so deliveries read committed state,
      // and with ancestor bubbling (targeted nested writes reach row
      // patches, §4b).
      if (t.pc.p !== null || t.pc.dn !== null) {
        if (targetKeysPlain(t, t.v)) patchHooks.emitPatch(t, t.v, old);
        else patchHooks.demoteToEffects(t);
      } else {
        patchHooks.emitPatchAncestors(t);
      }
    }
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
  // Written-keys bound: trap writes record their keys, so the notify visits
  // O(written) nodes instead of every subscription on the record (a selection
  // map with thousands of per-key subscribers pays two visits per select,
  // not a full scan). Falls back to the full node scan when the bound can't
  // hold: no trap granularity (wk null), an array length write (WK_ALL —
  // implicit index deletes), accessors on the record (t.a — a getter node's
  // value can change when ANY key is written), or a non-plain prototype
  // (class instances: prototype getters derive from arbitrary fields).
  const wk0 = t.pc !== null ? t.pc.wk : null;
  // Overlay pbs chain to the COMMITTED object (#3044): a prototype-overlay
  // draft is plain data on its own layer, but its getPrototypeOf is the
  // committed container — judge plainness by the COMMITTED prototype or the
  // bound never engages for overlay writes (every plain-object setter batch
  // would full-scan: the exact selection-map workload wk exists for; jf
  // `select` regressed 2x on this).
  const writtenKeys =
    wk0 === WK_ALL || t.a === true || !plainProto(t.ovl ? (t.v as object) : pb) ? null : wk0;
  if (nodes !== null) {
    const keys: Iterable<PropertyKey> = writtenKeys ?? Reflect.ownKeys(nodes);
    for (const key of keys) {
      const node = nodes[key as any];
      if (node === undefined) continue;
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
    const keys: Iterable<PropertyKey> = writtenKeys ?? Reflect.ownKeys(has);
    for (const key of keys) {
      const node = has[key as any];
      if (node !== undefined) setSignal(node, key in pb && !(t.del !== null && t.del.has(key)));
    }
  }
  // Deep-witness (dk): setter writes must notify a deep() subscriber even on
  // keys with no node. O(written/pb keys) equality only when a witness exists.
  if (t.dk !== null) {
    if (t.del !== null && t.del.size !== 0) bumpDeep(t);
    else
      for (const key of writtenKeys ?? Reflect.ownKeys(pb)) {
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
  // Patch channel: setter writes bump at FOLD COMMIT (post-swap), not here
  // — a write-time bump raced the fold at transition settle, delivering
  // pre-fold state (node-delivery port). drainFolds owns the emission.
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
  //   EXCEPT under an active transaction (#3164 fold): a landing riding a
  //   retaining transaction (the optimistic module's aroundWrite binds it)
  //   stages instead — ensurePB stamped foldBatches, so the backing commits
  //   with the transaction and the reveal is atomic at settle. The pinned
  //   immediate-commit contract is stated over the no-transaction microtask
  //   posture, which `activeTransition === null` is exactly.
  if (t.fam !== null && t.pb !== null && getWriteOverride() && activeTransition === null) {
    // Landed truth (post-await write-override): immediately visible to every
    // reader — any staged held view is superseded.
    if (t.ht !== null) t.ht = t.hv = null;
    const oldBacking = t.v;
    t.pb = null;
    t.v = pb;
    t.ch = false;
    // Node delivery: post-await landings commit HERE (no fold pass) — bump
    // post-swap so the delivery reads landed truth. The landed target may
    // have NO channel of its own (round 10, P1-2) — ancestors' compiled
    // bodies still read into it through nested chains, so the seam always
    // reaches the bubbling primitive: emitPatch bubbles internally, and the
    // demote/channel-less branches bubble explicitly.
    if (patchHooks !== null) {
      if (t.pc !== null && (t.pc.p !== null || t.pc.dn !== null)) {
        if (targetKeysPlain(t, t.v)) patchHooks.emitPatch(t, t.v, oldBacking);
        else {
          patchHooks.demoteToEffects(t);
          patchHooks.emitPatchAncestors(t);
        }
      } else patchHooks.emitPatchAncestors(t);
    }
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

export function arrayStructureChanged(old: any[], neu: any[]): boolean {
  if (old.length !== neu.length) return true;
  for (let i = 0; i < neu.length; i++) {
    const ov = old[i];
    const nv = neu[i];
    if (!isEqual(ov, nv) && !targetsEqual(ov, nv)) return true;
  }
  return false;
}

export function membershipChanged(
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): boolean {
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

/** CHILDREN_FORBIDDEN execution scope (createTrackedEffect / onSettled
 * callbacks). Distinct from context-free: these scopes get committed
 * visibility even against a projection's authoritative-elect pending
 * backing (#3082) — parity with signals, where core read() serves
 * committed to them regardless of staged writes. */
function inForbiddenScope(): boolean {
  const c: any = getOwner();
  if (c === null) return false;
  const eff = c._root ? c._parentComputed : c;
  return eff != null && !!(eff._config & CONFIG_CHILDREN_FORBIDDEN);
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
  // Held view first (#3074): an adoption staged under a live hold serves the
  // pre-hold committed backing to committed-visibility readers. Speculative
  // readers — drafts, write-override, owner-context computeds recomputing
  // inside the transaction, and latest() reads — see the adopted backing.
  if (
    target.ht !== null &&
    !latestReadActive &&
    !inDraft(target) &&
    !getWriteOverride() &&
    !inOwnerContext()
  ) {
    const hv = heldMaskView(target);
    if (hv !== null) return hv;
  }
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
      // Owner-context readers see the pending backing — EXCEPT held truth
      // on an optimistic family (#3164 fold): a live pb on an opt family
      // outside the draft/write-override windows is a staged landing
      // (tentative drafts never outlive their setter), and only the
      // authoritative postures and latest() see it (the backing-level twin
      // of core read()'s A17-for-held-truth arm; ordinary readers keep
      // committed until the transaction's reveal).
      (inOwnerContext() && !heldTruthMasked(target)) ||
      // A projection's pending backing is authoritative-elect: serve it to
      // context-free readers too UNLESS a transition is holding the node
      // commits (downstream async hold — stale committed is the contract)
      // or the reader is a CHILDREN_FORBIDDEN scope, which never observes
      // its own unsettled write (#3082, signal parity per #3006).
      (target.fam !== null && !heldTruthMasked(target) && !foldHeld(target) && !inForbiddenScope()))
  )
    return target.pb;
  return target.v;
}

/** #3164 fold: HELD truth on an optimistic family — a pending backing
 * stamped by a live transition that retains optimism — is masked from
 * ordinary readers (they keep committed until the transaction's reveal);
 * the authoritative postures and latest() tunnel through. Un-stamped
 * backings and optimism-free transitions keep ordinary mid-batch/
 * speculation visibility. */
function heldTruthMasked(target: StoreNextTarget): boolean {
  if (target.fam?.opt !== true || latestReadActive || authoritativeServe()) return false;
  const fb = foldBatches.get(target);
  // opt families are only created by createOptimisticStore, whose module
  // install populates optHooks — the assertion holds by construction.
  return fb !== undefined && optHooks!.retainsOptimism(fb);
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

/** The reading computation is until()'s authoritative-view predicate — same
 * source of truth as core read()'s A17 carve-out (`context`, which persists
 * under untrack). optimisticView()'s composition gate consults exactly this:
 * write-side machinery (patch emission, tentative re-application) must keep
 * composing even when it runs inside an authoritative-write bracket. */
export function authoritativeRead(): boolean {
  const c = context as any;
  return c !== null && (c._config & CONFIG_AUTHORITATIVE_READ) !== 0;
}

/** Serve-side authoritative gate: until()'s predicate PLUS truth authors —
 * the projection derive's draft (wrapDraft trap brackets, runAuthoritative;
 * the same posture pair ensurePB classifies drafts by). A source computing
 * the next truth must never read its callers' tentative overlays: a derive
 * continuation's `store.push` computing its index from an action's
 * optimistic row landed truth in the wrong slot and corrupted committed
 * state (#3108). Trap-level overlay serves gate on this so values, length,
 * membership, and keys leave the authoritative view together. */
export function authoritativeServe(): boolean {
  return projectionWriteActive || getWriteOverride() || authoritativeRead();
}

/** Context-aware node view for reads outside tracking: active override >
 * held pending (owner context) > the BACKING value. Committed truth lives in
 * the backing (single-home rule, O6) — node `_value` is never served here,
 * so a lazy recompute's landing is immediately visible to the untracked
 * reader that forced it (backing commits eagerly; node values fold at flush).
 * FORCE sentinels never surface (they only bump subscribers of accessor
 * keys, which are served by the trap, not the node). */
function nodeValue(node: Signal<any>, backing: any): any {
  // latest() sees the in-flight parked value like an owner-context reader
  // does (#3075) — signal/memo parity for store-node-backed keys.
  // Authoritative-view reads (until()'s predicate) skip the override arm
  // only: staged pending values are authoritative, overrides are the
  // caller's optimism.
  const v =
    !authoritativeServe() && hasActiveOverride(node)
      ? unwrapOverride(node._x?._overrideValue)
      : node._pendingValue !== NOT_PENDING &&
          (latestReadActive ||
            // Owner-context pending visibility — except HELD truth (#3164,
            // see CONFIG_HELD_TRUTH: fold-staged or entangle-stolen
            // confirming truth), which only authoritative/latest readers
            // see (core read()'s A17-for-held-truth twin; ordinary readers
            // keep committed until the transaction's reveal — latest() is
            // exempted by the leading arm above).
            ((inOwnerContext() || authoritativeServe()) &&
              !(node._config & CONFIG_HELD_TRUTH && !authoritativeServe())))
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
    // Truth authors read the backing's own length — an optimistic row from
    // the caller's transaction must not shift where the author's next write
    // lands (#3108).
    return ((authoritativeServe() ? src : optHooks!.optimisticView(target, src)) as any[]).length;
  }
  if (inDraft(target)) {
    // Optimistic drafts before their first write have no pending backing yet;
    // reads must still see the live optimistic view (compose, not clobber —
    // #2951). Once ensurePB runs, the seeded clone carries the view.
    // AUTHORITATIVE drafts (projection derive) never overlay — ensurePB's
    // seeding rule, applied to the read side (#3108).
    if (target.fam?.opt && target.pb === null && !authoritativeServe()) {
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
  // Own-draft ops are exempt: an async derive's continuation (generator body
  // after an `await`/`yield`) runs OUTSIDE the sync write scope (inDraft is
  // already false), but its draft-proxy traps mark every op with the write
  // override. Those reads are the derive working its own draft (state.push
  // reading .length) — gating them throws NotReadyError back into the derive
  // itself, which the post-await read diagnostic (#2987) then escalates to a
  // reactivity halt. The gate exists for EXTERNAL readers (seed invisibility,
  // proj R23); the derive is the author.
  if (projectionWriteActive || getWriteOverride()) return;
  const fw: any = target.fam?.node;
  if (fw != null && fw._statusFlags & (STATUS_UNINITIALIZED | STATUS_ERROR)) readNode(fw);
}

/** latest() pull (#3075): bring the projection computed up to date so the
 * read serves the IN-FLIGHT derivation — signal/memo parity, where core
 * read() routes latest() through a companion that recomputes speculatively.
 * The latest flag is suspended for the recompute (the derive's own reads
 * are normal reads), and latestPullActive marks any adoption it commits as
 * staged (see adoptPB) — the speculative swap must not leak to
 * committed-visibility readers before the flush. */
function pullProjectionForLatest(target: StoreNextTarget): void {
  const fw = target.fam!.node;
  if (fw == null) return;
  const prevLatest = latestReadActive;
  setLatestReadActive(false);
  const prevPull = latestPullActive;
  latestPullActive = true;
  try {
    prepareComputed(fw as any, true);
  } finally {
    latestPullActive = prevPull;
    setLatestReadActive(prevLatest);
  }
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
    // latest() pull (#3075): store traps never reach core read() without an
    // observer, so bring the projection computed up to date here — signal/
    // memo parity for latest() reads through a projection.
    if (target.fam !== null && latestReadActive && !inDraft(target) && !getWriteOverride())
      pullProjectionForLatest(target);
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
      } else if (
        v === undefined &&
        inDraft(target) &&
        target.fam?.opt &&
        target.pb === null &&
        // AUTHORITATIVE drafts (landing folds) never seed from overrides —
        // the caller's optimism is not truth (has-trap twin below).
        !authoritativeServe()
      ) {
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
        // Authoritative-view readers get the right answer for free: core read()
        // skips the override arm for them, so nv is authoritative presence.
        const nv = readNode(node);
        if (hasActiveOverride(node)) present = !!nv;
      } else if (!authoritativeServe()) {
        const node = target.h?.[key as any];
        if (node !== undefined && hasActiveOverride(node))
          present = !!unwrapOverride(node._x?._overrideValue);
      }
    } else if (target.fam?.opt && target.pb === null && !authoritativeServe()) {
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
    // seeded with the view). Authoritative-view reads (until()'s predicate,
    // truth-author drafts) skip the overlay.
    if (
      !authoritativeServe() &&
      target.fam?.opt &&
      target.h !== null &&
      (!inDraft(target) || target.pb === null)
    ) {
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
    if (!authoritativeServe() && target.fam?.opt && !inDraft(target)) {
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
    // Array length writes implicitly delete indices — the written-keys bound
    // can't see them, so poison to the full scan for this batch. Index
    // writes implicitly GROW length, so arrays always record it alongside.
    const pcs = pcOf(target);
    if (Array.isArray(pb)) {
      if (key === "length") pcs.wk = WK_ALL;
      else if (pcs.wk !== WK_ALL) {
        const wk = (pcs.wk ??= new Set());
        wk.add(key);
        wk.add("length");
      }
    } else if (pcs.wk !== WK_ALL) (pcs.wk ??= new Set()).add(key);
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
    if (desc.get || desc.set) {
      target.a = true;
      // Accessor demotion (re-audit blocker 3): a record that acquires an
      // accessor after patch registration stops being patchable — pull its
      // patches and re-drive them as tracked effect fallbacks. Hooks are
      // installed whenever pc.p exists (registration installs them).
      if (target.pc !== null && target.pc.p !== null) patchHooks!.demoteToEffects(target);
    }
    // Unwrap before ensurePB (see the set trap: self-reference materializes).
    if ("value" in desc) desc = { ...desc, value: unwrapValue(desc.value) };
    const pb = ensurePB(target);
    pendingNotify.add(target);
    const pcd = pcOf(target);
    if (pcd.wk !== WK_ALL) (pcd.wk ??= new Set()).add(key);
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
    const pcx = pcOf(target);
    if (pcx.wk !== WK_ALL) (pcx.wk ??= new Set()).add(key);
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

/** True when `proxy` is a SHALLOW store (children served verbatim, slots
 * replaced by reference — #2932). The list driver uses this to choose the
 * slot-patch channel (collected row bodies) over per-record registration. */
export function storeIsShallow(proxy: any): boolean {
  const t: StoreNextTarget | undefined = proxy?.[$TARGET];
  return t !== undefined && t.s === true;
}

/** True when `proxy` belongs to a projection/optimistic FAMILY. The list
 * driver must DECLINE family arrays (external audit finding): family
 * structural changes never emit row/slot ops (the setter channel is
 * fam-gated; optimistic writes ride node overrides), and the proxy identity
 * is stable so the each-watch cannot catch the change either — an engaged
 * list would freeze on optimistic/projection structural updates. Record-
 * level family patches are unaffected (they have their own emission). */
export function storeHasFamily(proxy: any): boolean {
  const t: StoreNextTarget | undefined = proxy?.[$TARGET];
  return t !== undefined && t.fam !== null;
}

/** True when `proxy` belongs to an OPTIMISTIC family specifically. The list
 * driver declines these (audit finding, narrowed): optimistic user writes
 * ride node-level overrides — they never enter the reconcile walk, so no
 * row/slot ops are emitted and an engaged list would freeze on optimistic
 * structural changes. PROJECTION (non-optimistic) families are drivable:
 * their recomputes go through the reconcile walk, whose emissions are
 * transition-stamped in the apply queue like any other (equivalence-matrix
 * gated). Re-admitting optimistic families requires a lane-timed structural
 * emission mirroring emitPatchOptimistic, plus revert resync. */
export function storeHasOptimisticFamily(proxy: any): boolean {
  const t: StoreNextTarget | undefined = proxy?.[$TARGET];
  return t !== undefined && t.fam?.opt === true;
}

/** Family identity token for list retention (round 10, P1-7): two families
 * can wrap the SAME raw rows, and retention keyed on raw identity alone
 * keeps the old family's DOM and registrations across a subject swap.
 * `null` = the global (family-less) namespace, where one raw maps to one
 * proxy and raw-identity retention is exact. */
export function storeFamilyOf(proxy: any): unknown {
  const t: StoreNextTarget | undefined = proxy?.[$TARGET];
  return t !== undefined ? (t.fam ?? null) : null;
}

/** Tracking deep snapshot (`deep()` for next targets): subscribes to the
 * key-set and deep-witness node at every reachable level, then returns the
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
