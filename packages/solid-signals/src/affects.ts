import { forEachDependent } from "./core/async.js";
import { STATUS_PENDING } from "./core/constants.js";
import { emitDiagnostic } from "./core/dev.js";
import { NotReadyError } from "./core/error.js";
import { $REFRESH, type Computed, type Signal } from "./core/index.js";
import { devTrackAffects } from "./core/invariants.js";
import { GlobalQueue, globalQueue, schedule, shiftAffectsMarks } from "./core/scheduler.js";
import type { Accessor } from "./signals.js";
import { $TARGET, getStoreAffectsNodes, type Store, type StoreNode } from "./store/store.js";

type MarkedNode = Signal<any> | Computed<any>;

/**
 * The counting half of a mark, shared by direct registration and store-scope
 * inheritance (a node created inside a live keyless mark's identity scope).
 * A mark is ONLY this count: coverage of everything derived from the node is
 * pull-derived by the verdict layer's `markWalk` (dep-graph reachability), so
 * nothing is stored downstream and nothing can be stranded or stripped by
 * mid-window recomputes.
 */
function markAffects(node: MarkedNode): void {
  node._affectsCount = (node._affectsCount || 0) + 1;
  shiftAffectsMarks(1);
  if (__DEV__) devTrackAffects(node);
}

/**
 * Boundary visual channel: within a transaction, a live mark holds Loading
 * fallbacks / reveal ordering the way real in-flight async would — but the
 * notification is tagged visibility-only at the source (`_markVisual`), so
 * the root queue never registers reporters from it: marks are invisible to
 * ALL completion and settlement accounting by construction. Boundaries hold
 * the marked node in `_sources` while `_affectsCount` is live; the release
 * sweep (finalizePureQueue re-checks boundary children after mark release)
 * is the display-state update point. Ambient marks release inside the same
 * flush that would surface them, before effects run — verdict-only, netting
 * no visual change.
 */
function notifyMarkBoundaries(node: MarkedNode): void {
  if (!node._subs && !(node as Computed<any>)._child) return;
  const error = new NotReadyError(node);
  error._markVisual = true;
  const visited = new Set<Computed<any>>();
  const visit = (sub: Computed<any>) => {
    if (visited.has(sub)) return;
    visited.add(sub);
    // Display consumers (render effects, boundary computeds) act on the
    // notification; descent stops there, exactly like the status rails.
    if (sub._notifyStatus) {
      sub._notifyStatus(STATUS_PENDING, error);
      return;
    }
    forEachDependent(sub, visit);
  };
  forEachDependent(node as Computed<any>, visit);
}

/**
 * Registers one `affects()` mark on a node: counts it, records the
 * registration with the current transaction (after initTransition the queue's
 * batch IS the active transition, mirroring `_optimisticNodes`), re-derives
 * every downstream verdict companion (the mark channel's only push — verdict
 * pokes, not state), and notifies boundary display state. Both walks run on
 * every registration (not just the first): subscribers gained since an
 * earlier overlapping registration get covered, and dedup stops re-descent.
 */
function registerAffectsMark(node: MarkedNode): void {
  markAffects(node);
  globalQueue._batch._affectsNodes.push(node);
  // Companions only exist once the verdict layer (isPending/latest) loaded;
  // without them there is no materialized verdict to poke.
  GlobalQueue._repollVerdicts !== null && GlobalQueue._repollVerdicts(node as Computed<any>);
  notifyMarkBoundaries(node);
  schedule();
}

/**
 * Releases one registration. When the node's last mark drops, re-derives
 * every downstream verdict through the settlement snap (committed, not
 * transition-scoped — release runs inside queue finalization, where a
 * setSignal would open a fresh override window that nothing settles).
 */
function releaseAffectsMark(node: MarkedNode): void {
  shiftAffectsMarks(-1);
  node._affectsCount!--;
  if (!node._affectsCount) {
    GlobalQueue._repollVerdicts !== null &&
      GlobalQueue._repollVerdicts(node as Computed<any>, true);
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

// Late installation (same pattern as `GlobalQueue._update`): the mark engine
// lives with the feature so graphs that never declare a mark never ship it.
// Each call site is gated by state only this module creates (a non-empty
// `_affectsNodes` batch, a live scope in the store's `affectsScopes`), so the
// hooks are installed before the first time any of them can fire.
GlobalQueue._releaseAffectsMarks = releaseAffectsMarks;
GlobalQueue._markAffects = markAffects;
GlobalQueue._releaseAffectsMark = releaseAffectsMark;

/**
 * Declares that in-flight work will change the targeted data: the named
 * slot(s) — and everything DERIVED from them — read as pending
 * (`isPending` → `true`) from the declaration until the surrounding
 * transaction settles or reverts. A mark lives on its own channel — a
 * refcount on the marked node plus dep-graph reachability in the verdict
 * layer — so the marked values themselves stay readable (a mark is a promise
 * of change, not an absence of value), no reader ever suspends on one, and
 * completion/settlement accounting never sees one. This is the declaration
 * verb of the pending model — additive only. A mark can turn pending ON for
 * data the graph can't see changing yet; nothing can turn pending OFF while
 * a real change is in flight — a quiet `refresh()` re-ask under a mark still
 * reads pending (declaring the reload is what makes it a real question).
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
