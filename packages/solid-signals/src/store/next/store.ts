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
import { NOT_PENDING, STATUS_UNINITIALIZED } from "../../core/constants.js";
import {
  devGuardStoreSetterWrite,
  isEqual,
  read as readNode,
  setSignal,
  signal,
  untrack
} from "../../core/core.js";
import { getObserver, getOwner } from "../../core/owner.js";
import { schedule, setStoreCommitHook } from "../../core/scheduler.js";
import type { Signal } from "../../core/types.js";
import { pendingCheckActive, strictRead } from "../../core/core.js";
import { DEV, registerGraph, warnStrictReadUntracked } from "../../core/dev.js";
import {
  $PROXY,
  $TARGET,
  $TRACK,
  getWriteOverride,
  isRawValue,
  isWrappable,
  rawValuesUsed,
  storeLookup as legacyStoreLookup,
  witnessAffectsMark
} from "../store.js";
import {
  devAssertNeverUserMutation,
  ingestedRaw,
  ownedRaw,
  storeNextLookup,
  type StoreNextFamily,
  type StoreNextTarget
} from "./target.js";

// ---------------------------------------------------------------------------
// wrap / dedupe

function createTarget(
  value: Record<PropertyKey, any>,
  parent: StoreNextTarget | null,
  parentKey: PropertyKey | null,
  fam: StoreNextFamily | null = parent?.fam ?? null
): StoreNextTarget {
  // The proxy target carries the array exotic class when the value is an
  // array, so Array.isArray(proxy) is true; the fields live on it directly.
  const t: StoreNextTarget = Object.assign(Array.isArray(value) ? ([] as any) : {}, {
    v: value,
    pb: null,
    n: null,
    h: null,
    k: null,
    u: parent,
    pk: parentKey,
    px: null,
    d: false,
    a: false,
    sc: false,
    adopted: false,
    fam,
    s: false
  });
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
  // Cross-implementation dedupe (core R2): a raw already tracked by the
  // legacy store (shallow roots, projection families) serves its legacy
  // proxy — one raw, one logical node, either implementation.
  const legacy = legacyStoreLookup.get(value);
  if (legacy !== undefined) return (legacy as any)[$PROXY];
  return createTarget(value, parent, parentKey, fam).px;
}

/** Unwrap our own proxies to their current backing; leave everything else. */
export function unwrapValue(v: any): any {
  if (v == null || typeof v !== "object") return v;
  const t: StoreNextTarget | undefined = v[$TARGET];
  if (t !== undefined && t.px === v && t.v !== undefined) return t.pb ?? t.v;
  return v;
}

// ---------------------------------------------------------------------------
// nodes: pure subscription points (values used only for equality gating)

function getNode(target: StoreNextTarget, key: PropertyKey, current: any): Signal<any> {
  const nodes = (target.n ??= Object.create(null));
  let node: Signal<any> | undefined = nodes[key];
  if (node === undefined) {
    const created: Signal<any> = (node = signal(
      current,
      {
        // Logical-slot equality: values resolving to the same child target
        // are the same slot (privatization/adoption swap raw identity without
        // changing the logical value — only changed leaves notify, R9).
        equals: (a: any, b: any) => isEqual(a, b) || sameLogicalSlot(target, a, b),
        unobserved() {
          if (target.n && target.n[key] === created) delete target.n[key];
        }
      },
      // Projection nodes carry the projection computed as their firewall:
      // reads through them link the derive's status/lifecycle (§7b).
      (target.fam?.node as any) ?? undefined
    ));
    nodes[key] = node;
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

function getHasNode(target: StoreNextTarget, key: PropertyKey, present: boolean): Signal<boolean> {
  const nodes = (target.h ??= Object.create(null));
  let node: Signal<boolean> | undefined = nodes[key];
  if (node === undefined) {
    const created: Signal<boolean> = (node = signal(present, {
      equals: isEqual,
      unobserved() {
        if (target.h && target.h[key] === created) delete target.h[key];
      }
    }));
    nodes[key] = node;
    markDescendants(target);
  }
  return node;
}

function getKeySetNode(target: StoreNextTarget): Signal<number> {
  let k = target.k;
  if (k === null) {
    const created: Signal<number> = (k = signal(0, {
      equals: false,
      unobserved() {
        if (target.k === created) target.k = null;
      }
    }));
    target.k = k;
    markDescendants(target);
  }
  return k;
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

function ensurePB(target: StoreNextTarget): Record<PropertyKey, any> {
  let pb = target.pb;
  if (pb === null) {
    pb = target.pb = cloneRaw(target.v, target);
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
export function adoptPB(target: StoreNextTarget, incoming: Record<PropertyKey, any>): void {
  queueFold(target); // records the pre-batch old before we swap
  target.pb = null;
  target.adopted = true;
  target.v = incoming;
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
      t.v = pb;
      t.pb = null;
    }
    if (t.v === old) continue; // adopted then re-adopted back, or no-op
    // Path copying: the parent's committed slot must point at the new backing.
    if (t.u && t.u.v[t.pk!] !== t.v) {
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
  const pb = t.pb;
  if (pb === null) return;
  const old = t.v;
  // Devtools mutation hook: full-key diff (dev-only cost) so unobserved
  // writes report too, matching the legacy set-trap hook.
  if (__DEV__ && DEV.hooks.onStoreNodeUpdate) {
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
      if (t.a) {
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
      const nv = pb[key as any];
      setSignal(node, () => nv);
    }
  }
  const has = t.h;
  if (has !== null) {
    for (const key of Reflect.ownKeys(has)) setSignal(has[key as any], key in pb);
  }
  if (t.k !== null) {
    const changed =
      Array.isArray(pb) && Array.isArray(old)
        ? arrayStructureChanged(old as any[], pb as any[])
        : membershipChanged(old, pb);
    if (changed) setSignal(t.k, v => v + 1);
  }
}

const FORCE: unique symbol = Symbol();

/** Same logical slot: both values resolve to one (re-pointed) child target —
 * adoption preserved identity, so the slot did not change (R9). */
function targetsEqual(ov: any, nv: any): boolean {
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
function notifyFold(
  t: StoreNextTarget,
  old: Record<PropertyKey, any>,
  neu: Record<PropertyKey, any>
): void {
  const nodes = t.n;
  if (nodes !== null) {
    for (const key of Reflect.ownKeys(nodes)) {
      const node = nodes[key as any];
      if (t.a) {
        const od = Object.getOwnPropertyDescriptor(old, key);
        const nd = Object.getOwnPropertyDescriptor(neu, key);
        if ((od && (od.get || od.set)) || (nd && (nd.get || nd.set))) {
          // Accessor involved: never invoke; force-notify on shape change so
          // subscribers re-read (and re-track) through the trap.
          if (od?.get !== nd?.get || od?.set !== nd?.set || od?.value !== nd?.value)
            setSignal(node, () => FORCE as any);
          continue;
        }
        const ov = od?.value;
        const nv = nd?.value;
        if (!isEqual(ov, nv) && !targetsEqual(ov, nv)) setSignal(node, () => nv);
      } else {
        const ov = old[key as any];
        const nv = neu[key as any];
        if (!isEqual(ov, nv) && !targetsEqual(ov, nv)) setSignal(node, () => nv);
      }
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

/** Targets written during the current (outermost) setter — notified at exit. */
const pendingNotify = new Set<StoreNextTarget>();

const UNSAFE_KEYS = new Set<PropertyKey>(["__proto__", "prototype", "constructor"]);

/** Mirror of core read()'s context rule: the OWNER context (not the tracking
 * observer) decides pending visibility, with Roots resolving to their parent
 * computed (#2687 — untracked reads inside mapArray Roots see in-flight
 * values mid-flush). */
function inOwnerContext(): boolean {
  const c: any = getOwner();
  if (c === null) return false;
  if (c._root) return c._parentComputed != null;
  return true;
}

function readSource(target: StoreNextTarget): Record<PropertyKey, any> {
  // Signal-parity visibility (core read(): owner-context reads serve
  // _pendingValue, context-free reads serve committed — effects recompute
  // BEFORE commitPendingNodes in the flush, so the pending view must be
  // servable). Drafts (setter window OR projection write-override) and
  // owner-context reads see the pending backing; context-free reads see
  // committed. Node reads apply the same rule, so both homes agree.
  if (target.pb !== null && (writing || inOwnerContext())) return target.pb;
  return target.v;
}

/** Scan-once accessor detection (first trap read): sets `a` definitively so
 * every later read on accessor-free targets is a plain property load. */
function scanAccessors(target: StoreNextTarget, src: Record<PropertyKey, any>): void {
  target.sc = true;
  if (target.a) return;
  const descs = Object.getOwnPropertyDescriptors(src);
  for (const key of Reflect.ownKeys(descs)) {
    const d = (descs as any)[key];
    if (d.get || d.set) {
      target.a = true;
      return;
    }
  }
}

const hasOwn = Object.prototype.hasOwnProperty;

/** Context-aware node value (mirrors core read()'s pending rule) for reads
 * outside tracking; FORCE sentinels never surface (they only exist to bump
 * subscribers of accessor keys, which are served by the trap, not the node). */
function nodeValue(node: Signal<any>, fallback: any): any {
  const v =
    node._pendingValue !== NOT_PENDING && inOwnerContext() ? node._pendingValue : node._value;
  return v === (FORCE as any) ? fallback : v;
}

/** Serve an own data key: node-first when a node exists (pending visibility,
 * holds, lanes ride the node); backing otherwise. */
function serveDataKey(
  target: StoreNextTarget,
  key: PropertyKey,
  backingValue: any,
  src: Record<PropertyKey, any>
): any {
  void src;
  let v = backingValue;
  if (!writing) {
    const node = target.n?.[key as any];
    if (node !== undefined) {
      if (getObserver() !== null) {
        const nv = readNode(node);
        v = nv === (FORCE as any) ? backingValue : nv;
      } else {
        v = nodeValue(node, backingValue);
      }
    } else if (getObserver() !== null) {
      readNode(getNode(target, key, backingValue));
    }
  }
  return isWrappable(v) ? wrapNext(v, target, key as any) : v;
}

/** §6c store-wide status gate: while a projection's derive is uninitialized
 * (async first flight), EVERY read throws NotReady — probed untracked so the
 * gate never coarsens fine-grained isolation (proj R12). */
function firewallGate(target: StoreNextTarget): void {
  const fw: any = target.fam?.node;
  if (fw != null && fw._statusFlags & STATUS_UNINITIALIZED) untrack(() => readNode(fw));
}

const traps: ProxyHandler<StoreNextTarget> = {
  get(target, key, receiver) {
    if (key === $TARGET) return target;
    if (key === $PROXY) return receiver;
    if (pendingCheckActive) witnessAffectsMark(target as any, key);
    if (!writing && target.fam !== null) firewallGate(target);
    const src = readSource(target);
    if (key === $TRACK) {
      if (!writing && getObserver() !== null) readNode(getKeySetNode(target));
      return undefined;
    }
    // Dev strictRead: untracked store reads in labeled scopes (component
    // bodies, effect callbacks) warn — the value can never update the reader.
    if (__DEV__ && strictRead && !writing && typeof key === "string" && getObserver() === null) {
      warnStrictReadUntracked(strictRead, {
        nodeName: key,
        data: { strictRead, property: key, source: "store" }
      });
    }
    if (!target.sc) scanAccessors(target, src);
    if (target.a) {
      const own = Object.getOwnPropertyDescriptor(src, key);
      // Accessors run against the proxy (R20/R29): their internal reads
      // track; the node (if any) is linked for shape-change notification but
      // its value is never served for accessor keys.
      if (own && (own.get || own.set)) {
        if (!writing && getObserver() !== null) {
          const node = target.n?.[key];
          if (node) readNode(node);
        }
        const v = own.get ? own.get.call(receiver) : undefined;
        return isWrappable(v) ? wrapNext(v, target, key) : v;
      }
      if (own !== undefined) {
        return serveDataKey(target, key, own.value, src);
      }
      // fall through to the absent/inherited path below
    }
    // Plain-data fast path: no descriptor allocation per read.
    // Inherited pollution keys are never served (core R30) — checked before
    // the proto-function branch can leak `constructor`.
    if (UNSAFE_KEYS.has(key) && !hasOwn.call(src, key)) return undefined;
    let v = (src as any)[key];
    if (v === undefined ? !hasOwn.call(src, key) : false) {
      // Inherited: prototype getters/methods run with the proxy receiver.
      v = Reflect.get(src, key, receiver);
      if (typeof v === "function") return v; // proto methods untracked
      // Reading a currently-absent own key subscribes to it (R12).
      if (v === undefined && !writing) {
        if (getObserver() !== null) readNode(getNode(target, key, undefined));
        const node = target.n?.[key];
        if (node) return nodeValue(node, undefined);
      }
      return isWrappable(v) ? wrapNext(v, target, key) : v;
    }
    if (typeof v === "function" && !hasOwn.call(src, key)) return v; // proto method
    return serveDataKey(target, key, v, src);
  },

  has(target, key) {
    if (key === $TARGET || key === $PROXY || key === $TRACK) return true;
    if (pendingCheckActive) witnessAffectsMark(target as any, key);
    if (!writing && target.fam !== null) firewallGate(target);
    const src = readSource(target);
    const present = key in src;
    if (!writing && getObserver() !== null) readNode(getHasNode(target, key, present));
    return present;
  },

  ownKeys(target) {
    if (pendingCheckActive) witnessAffectsMark(target as any);
    if (!writing && target.fam !== null) firewallGate(target);
    if (!writing && getObserver() !== null) readNode(getKeySetNode(target));
    return Reflect.ownKeys(readSource(target));
  },

  getOwnPropertyDescriptor(target, key) {
    const desc = Object.getOwnPropertyDescriptor(readSource(target), key);
    if (desc === undefined) return undefined;
    // Array targets carry a real non-configurable `length` the proxy
    // invariant forces us to report faithfully; everything else reports
    // configurable via target indirection (core R51).
    if (!(key === "length" && Array.isArray(target))) desc.configurable = true;
    return desc;
  },

  set(target, key, value) {
    // Writes require the setter window OR the projection draft's write
    // override (post-await async draft writes arrive outside any window);
    // everything else is silently ignored (R23).
    const override = !writing && getWriteOverride();
    if (!writing && !override) return true;
    if (key === "__proto__") return true; // pollution guard (core R30)
    const pb = ensurePB(target);
    pendingNotify.add(target);
    // Own data keys literally named "prototype"/"constructor" land as data —
    // defineProperty sidesteps a proto-chain setter named the same.
    if (UNSAFE_KEYS.has(key)) {
      Object.defineProperty(pb, key, {
        value: unwrapValue(value),
        writable: true,
        enumerable: true,
        configurable: true
      });
      return true;
    }
    pb[key as any] = unwrapValue(value);
    // Override-mode (post-await draft) writes have no setter exit — notify
    // per-op (setSignal equality-gates repeats).
    if (override) notifyWrites(target);
    return true;
  },

  defineProperty(target, key, desc) {
    const override = !writing && getWriteOverride();
    if (!writing && !override) return true;
    if (key === "__proto__") return true;
    if (desc.get || desc.set) target.a = true;
    const pb = ensurePB(target);
    pendingNotify.add(target);
    if ("value" in desc) desc = { ...desc, value: unwrapValue(desc.value) };
    Object.defineProperty(pb, key, desc);
    if (override) notifyWrites(target);
    return true;
  },

  deleteProperty(target, key) {
    const override = !writing && getWriteOverride();
    if (!writing && !override) return true;
    const pb = ensurePB(target);
    pendingNotify.add(target);
    delete pb[key as any];
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
    // Outermost setter exit: emit write-time notifications (setSignal per
    // changed observed key) so transition holds and lanes engage now.
    if (writing === 0 && pendingNotify.size) {
      const touched = [...pendingNotify];
      pendingNotify.clear();
      for (const t of touched) notifyWrites(t);
    }
  }
  if (result !== undefined && result !== proxy && isWrappable(result)) {
    // Returned replacement = adoption of the incoming object (unowned).
    adoptPB(target, unwrapValue(result));
  }
}

export function createStoreNext<T extends Record<PropertyKey, any>>(
  init: T
): [T, SetStoreNextFunction<T>] {
  const proxy = wrapNext(init);
  if (__DEV__) registerGraph(proxy, getOwner());
  const setter: SetStoreNextFunction<T> = fn => storeSetterNext(proxy, fn);
  return [proxy, setter];
}

// ---------------------------------------------------------------------------
// snapshot (next targets): the backing IS the plain raw graph — zero copy.
// Sees pending (R27) by reading pb. Chained/owned-copy caching lands with the
// utilities increment; this covers the createStore-suite contract.

export function isNextProxy(value: any): boolean {
  if (value == null || typeof value !== "object") return false;
  const t: StoreNextTarget | undefined = value[$TARGET];
  return t !== undefined && t.px === value && t.v !== undefined;
}

/** Tracking deep snapshot (`deep()` for next targets): subscribes to the
 * key-set and every property node at every reachable level, then returns the
 * plain view. Shared references and cycles handled via the visited set. */
export function deepNext<T>(value: T): T {
  const visited = new Set<object>();
  const walk = (v: any): void => {
    if (!isNextProxy(v)) return;
    const t: StoreNextTarget = v[$TARGET];
    const src = readSource(t);
    if (visited.has(src)) return;
    visited.add(src);
    readNode(getKeySetNode(t));
    for (const key of Reflect.ownKeys(src)) {
      const desc = Object.getOwnPropertyDescriptor(src, key);
      if (desc && (desc.get || desc.set)) {
        t.a = true;
        continue; // accessors track through their own reads when invoked
      }
      const child = (src as any)[key];
      readNode(getNode(t, key, child));
      if (isWrappable(child)) walk(wrapNext(child, t, key));
    }
  };
  walk(value);
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
  return snapshotWalk(value, new Map());
}

function snapshotWalk(value: any, seen: Map<object, any>): any {
  if (value === null || typeof value !== "object") return value;
  // Resolve through the registration: proxies AND raws map to their target's
  // current backing (stale raw pointers through other parents resolve here).
  let src = value;
  const t: StoreNextTarget | undefined =
    value[$TARGET]?.v !== undefined ? value[$TARGET] : storeNextLookup.get(value);
  if (t !== undefined) src = t.pb ?? t.v;
  if (!isWrappable(src)) return src;
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
      const walked = cv !== null && typeof cv === "object" ? snapshotWalk(cv, seen) : cv;
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
    const walked = snapshotWalk(cv, seen);
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
