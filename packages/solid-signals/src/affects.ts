import {
  addPendingSource,
  forEachDependent,
  notifyStatus,
  setPendingError,
  settlePendingSource
} from "./core/async.js";
import { STATUS_PENDING } from "./core/constants.js";
import { emitDiagnostic } from "./core/dev.js";
import { NotReadyError } from "./core/error.js";
import { $REFRESH, type Computed, type Signal } from "./core/index.js";
import { devTrackAffects } from "./core/invariants.js";
import {
  GlobalQueue,
  globalQueue,
  queuePendingNode,
  schedule,
  shiftAffectsMarks
} from "./core/scheduler.js";
import type { Accessor } from "./signals.js";
import { $TARGET, getStoreAffectsNodes, type Store, type StoreNode } from "./store/store.js";

type MarkedNode = Signal<any> | Computed<any>;

/**
 * The pending-source identity of a live `affects()` mark on `node` (lazy,
 * one per node, shared by overlapping registrations via the refcount).
 *
 * A mark rides the SAME status rails as real in-flight async — downstream
 * subscribers hold the sentinel in `_pendingSources` — but under its own
 * identity so the two channels can't clear each other:
 * - `_reask` is permanently `false`: a mark is by definition a declared
 *   value change, so `quietPending` never silences a window it participates
 *   in — even when the mark rides over an otherwise-quiet `refresh()`
 *   re-ask of the same node (the whole point of declaring one).
 * - A landing on the marked node settles only the node's OWN source entry;
 *   the sentinel entry survives until the mark's transaction releases it.
 * - The sentinel itself never carries `STATUS_PENDING`, so
 *   `transitionComplete` never counts a mark as a blocker of its own
 *   transaction (release happens AT settle — self-blocking would deadlock),
 *   and reads of the marked node never throw (marks are value-transparent
 *   at the source; pendingness is what propagates).
 */
function getAffectsSentinel(node: MarkedNode): Computed<any> {
  return (node._affectsSentinel ??= {
    _name: __DEV__ ? "affects-sentinel" : undefined,
    // Brand + backref: lets the scheduler's settlement checks recognize
    // mark-sourced pending (which must never block its own transaction —
    // release happens AT settle).
    _affectsFor: node,
    _flags: 0,
    _statusFlags: 0,
    _reask: false,
    _error: undefined,
    _subs: null,
    _deps: null
  } as unknown as Computed<any>);
}

/**
 * Push a live mark's pendingness downstream from the marked node through the
 * normal status rails. Runs on every registration (dedup in `notifyStatus`
 * stops re-descent at already-covered subscribers). Subscribers that
 * recompute mid-window shed this via `clearStatus` and re-acquire it through
 * the read path (`applyAffectsReads`) — the same shape as real async, where
 * the re-throw on read re-establishes the source.
 */
function propagateAffectsMark(node: MarkedNode): void {
  if (!node._subs && !(node as Computed<any>)._child) return;
  const sentinel = getAffectsSentinel(node);
  const error = new NotReadyError(sentinel);
  forEachDependent(node as Computed<any>, sub => {
    if (sub._pendingSource !== sentinel && !sub._pendingSources?.has(sentinel)) {
      if (!sub._transition) queuePendingNode(sub);
      notifyStatus(sub, STATUS_PENDING, error);
    }
  });
}

/**
 * Re-establish mark pendingness on a computed that read marked sources
 * during its recompute (`clearStatus` at the top of the commit path wiped
 * any sentinel entries it held). Called by `recompute` after the commit —
 * not before, because setting `_error` earlier would make the commit path
 * treat the node as errored and skip the value write.
 */
function applyAffectsReads(el: Computed<any>, sources: MarkedNode[]): void {
  let applied = false;
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (!src._affectsCount) continue;
    const sentinel = getAffectsSentinel(src);
    if (addPendingSource(el, sentinel)) {
      el._statusFlags |= STATUS_PENDING;
      setPendingError(el, sentinel);
      applied = true;
    }
  }
  if (applied && GlobalQueue._updatePendingSignal !== null) GlobalQueue._updatePendingSignal(el);
}

/**
 * The counting half of a mark, shared by direct registration and store-scope
 * inheritance (a node created inside a live keyless mark's identity scope):
 * bumps the refcount and pokes the node's verdict companions so an
 * already-materialized `false` flips reactively.
 */
function markAffects(node: MarkedNode): void {
  node._affectsCount = (node._affectsCount || 0) + 1;
  shiftAffectsMarks(1);
  if (__DEV__) devTrackAffects(node);
  // Companions only exist once the verdict layer (isPending/latest) loaded;
  // without them there is no materialized verdict to flip.
  if (node._affectsCount === 1 && GlobalQueue._updatePendingSignal !== null)
    GlobalQueue._updatePendingSignal(node);
}

/**
 * Registers one `affects()` mark on a node: counts it, records the
 * registration with the current transaction (after initTransition the queue's
 * array aliases the active transition's, mirroring `_optimisticNodes`), and
 * propagates STATUS_PENDING downstream on the status rails so everything
 * DERIVED from the marked data reads pending too. Propagation runs on every
 * registration (not just the first): subscribers gained since an earlier
 * overlapping registration get covered, and dedup stops re-descent early.
 */
function registerAffectsMark(node: MarkedNode): void {
  markAffects(node);
  globalQueue._affectsNodes.push(node);
  propagateAffectsMark(node);
  schedule();
}

/**
 * Releases one registration. When the node's last mark drops, settles the
 * mark's sentinel out of every downstream `_pendingSources` (waking blocked
 * nodes and re-deriving verdicts along the walk). Companion writes go through
 * the settlement snap (committed, not transition-scoped) so releasing a mark
 * can't open a fresh override window that would itself need settlement.
 */
function releaseAffectsMark(node: MarkedNode): void {
  shiftAffectsMarks(-1);
  node._affectsCount!--;
  if (!node._affectsCount) {
    const sentinel = node._affectsSentinel;
    if (sentinel) settlePendingSource(node as Computed<any>, sentinel, true);
    GlobalQueue._snapCompanions !== null && GlobalQueue._snapCompanions(node);
    GlobalQueue._releaseAffectsScope?.(node);
  }
}

/**
 * Releases one batch of affects marks (a settling transaction's, or the
 * ambient batch at a plain flush end).
 */
function releaseAffectsMarks(nodes: MarkedNode[]): void {
  for (let i = 0; i < nodes.length; i++) releaseAffectsMark(nodes[i]);
  nodes.length = 0;
}

/**
 * True when a node's pending status comes ONLY from affects() sentinels. A
 * mark is a promise of change, not an absence of value: reads of mark-pended
 * derived nodes stay value-transparent (verdicts report pending; the read
 * path must not suspend). Any real async source among the pending sources
 * keeps normal suspension semantics. Core's read path reaches this through
 * `GlobalQueue._onlyMarkPending`, gated on the `activeAffectsMarks` counter.
 */
function onlyMarkPending(el: Computed<any>): boolean {
  const sources = el._pendingSources;
  if (sources) {
    for (const s of sources) if (!s._affectsFor) return false;
    return true;
  }
  return !!el._pendingSource?._affectsFor;
}

// Late installation (same pattern as `GlobalQueue._update`): the mark engine
// lives with the feature so graphs that never declare a mark never ship it.
// Each call site is gated by state only this module creates (`markedReads`
// collection under `activeAffectsMarks`, a non-empty `_affectsNodes` batch,
// a live scope in the store's `affectsScopes`), so the hooks are installed
// before the first time any of them can fire.
GlobalQueue._applyAffectsReads = applyAffectsReads;
GlobalQueue._releaseAffectsMarks = releaseAffectsMarks;
GlobalQueue._markAffects = markAffects;
GlobalQueue._releaseAffectsMark = releaseAffectsMark;
GlobalQueue._onlyMarkPending = onlyMarkPending;

/**
 * Declares that in-flight work will change the targeted data: the named
 * slot(s) — and everything DERIVED from them — read as pending
 * (`isPending` → `true`) from the declaration until the surrounding
 * transaction settles or reverts. Marks ride the same status rails as real
 * in-flight async, so pendingness flows through memos and effects like any
 * other pending source, while the marked values themselves stay readable
 * (a mark is a promise of change, not an absence of value). This is the
 * declaration verb of the pending model — additive only. A mark can turn
 * pending ON for data the graph can't see changing yet; nothing can turn
 * pending OFF while a real change is in flight — a quiet `refresh()`
 * re-ask under a mark still reads pending (declaring the reload is what
 * makes it a real question).
 *
 * Targets:
 * - `affects(store)` — a store proxy (any record, root or nested): every
 *   record reachable from it at declaration time reads pending, including
 *   through captured child proxies (e.g. `<For>` rows). Siblings are
 *   untouched; records added after the declaration are not covered.
 * - `affects(record, key)` — exactly the named slot of the record. One key
 *   per call (keys do NOT form a path — target the owning record directly).
 * - `affects(accessor)` — a source accessor (signal or memo): the source
 *   reads pending.
 *
 * Typically called at the top of an `action` alongside optimistic writes —
 * both are up-front declarations about the same mutation. Outside any
 * transaction the mark is released at the end of the current flush.
 *
 * @example
 * ```ts
 * const send = action(function* (text: string) {
 *   setState(s => { s.messages.push({ text, status: "sending" }); });
 *   affects(state.messages.at(-1)!, "status"); // this slot pends until settle
 *   yield api.send(text);
 * });
 *
 * const reload = action(function* () {
 *   affects(thing);      // the whole store pends…
 *   refresh(thing);      // …over this otherwise-quiet re-ask
 *   yield api.done();
 * });
 * ```
 */
export function affects(target: Accessor<unknown> | Store<object>): void;
export function affects<T extends object>(target: Store<T>, key: keyof T): void;
export function affects(target: any, key?: PropertyKey): void {
  if (__DEV__ && arguments.length > 2) {
    const message =
      "[INVALID_AFFECTS_TARGET] affects() takes a single optional key — extra keys are " +
      "not a path. Mark each slot with its own affects(record, key) call, or pass the " +
      'nested record itself: affects(state.user, "name").';
    emitDiagnostic({
      code: "INVALID_AFFECTS_TARGET",
      kind: "write",
      severity: "error",
      message
    });
    throw new Error(message);
  }
  const storeTarget: StoreNode | undefined = target?.[$TARGET];
  if (storeTarget) {
    const nodes = getStoreAffectsNodes(storeTarget, key);
    for (let i = 0; i < nodes.length; i++) registerAffectsMark(nodes[i]);
    return;
  }
  const node: Signal<any> | Computed<any> | undefined = target?.[$REFRESH];
  if (node) {
    if (__DEV__ && key !== undefined) {
      const message =
        "[INVALID_AFFECTS_TARGET] affects() keys are only valid on store targets. " +
        "An accessor is a single slot — pass it alone, or target the store record that owns the property.";
      emitDiagnostic({
        code: "INVALID_AFFECTS_TARGET",
        kind: "write",
        severity: "error",
        message,
        nodeName: (node as any)._name
      });
      throw new Error(message);
    }
    registerAffectsMark(node);
    return;
  }
  if (__DEV__) {
    const message =
      "[INVALID_AFFECTS_TARGET] affects() expects a Solid source accessor or a store node. " +
      "Pass the store proxy (optionally with a property key) or the original accessor, " +
      "not a wrapper function or an already-read value.";
    emitDiagnostic({
      code: "INVALID_AFFECTS_TARGET",
      kind: "write",
      severity: "error",
      message
    });
    throw new Error(message);
  }
}
