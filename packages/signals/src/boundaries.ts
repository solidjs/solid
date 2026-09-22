import { recompute, ext, spectate, currentOptimisticLane } from "./core/core.js";
import { unwrapStatusError } from "./core/error.js";
import {
  cleanup,
  computed,
  CONFIG_AUTO_DISPOSE,
  createContext,
  createOwner,
  getContext,
  getOwner,
  NOT_PENDING,
  NotReadyError,
  Queue,
  read,
  REACTIVE_DISPOSED,
  REACTIVE_ZOMBIE,
  setContext,
  runWithOwner,
  setSignal,
  signal,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
  untrack,
  type Computed,
  type Effect,
  type Owner
} from "./core/index.js";
import type { IQueue, Signal } from "./core/index.js";
import { emitDiagnostic, reportDiagnostic } from "./core/dev.js";
import { attrHooks } from "./core/attribution-hooks.js";
import { reportClientError } from "./core/error-hooks.js";
import { enqueueSub } from "./core/heap.js";
import {
  currentTransition,
  haltReactivity,
  queueRearm,
  reporterBlocksSource,
  schedule,
  transitions,
  wakeParked
} from "./core/scheduler.js";
import { accessor, type Accessor } from "./signals.js";

export interface BoundaryComputed<T> extends Computed<T> {
  _propagationMask: number;
}

function boundaryComputed<T>(fn: () => T, propagationMask: number): BoundaryComputed<T> {
  const node = computed<T>(fn, { lazy: true }) as BoundaryComputed<T>;
  ext(node)._notifyStatus = (status?: number, error?: any) => {
    // Use passed values if provided, otherwise read from node
    const flags = status !== undefined ? status : node._statusFlags;
    const actualError = error !== undefined ? error : node._x?._error;
    // Notify both status dimensions like a render effect does; the queue chain
    // consumes this boundary's own type and forwards the remainder upward until
    // a boundary that handles it is found.
    node._statusFlags &= ~node._propagationMask;
    const handled = node._queue.notify(node, STATUS_PENDING | STATUS_ERROR, flags, actualError);
    // The queue is the only propagation channel: a foreign status must not stay
    // reader-visible on the tree, or reads re-throw it across the boundary and
    // link unrelated ambient contexts (the #2809 nested-boundary loop). Deps are
    // untouched, so the tree still recomputes when the foreign source settles.
    const foreign = flags & ~node._propagationMask & (STATUS_PENDING | STATUS_ERROR);
    if (foreign) {
      node._statusFlags &= ~foreign;
      if (node._x?._error === actualError && !(node._statusFlags & (STATUS_PENDING | STATUS_ERROR)))
        if (node._x !== null) node._x._error = undefined;
    }
    // An ERROR the chain could not deliver to any boundary is uncaught. The
    // scrub above already removed it from reader-visible state, so without
    // escalation here it would vanish entirely (#2884) — halt-and-throw,
    // exactly like an unhandled effect error.
    if (!handled && flags & STATUS_ERROR) {
      haltReactivity(unwrapStatusError(actualError));
      throw actualError;
    }
  };
  node._propagationMask = propagationMask;
  node._config &= ~CONFIG_AUTO_DISPOSE;
  recompute(node, true);
  return node;
}

/**
 * A boundary's `on` dependencies (#3540): `onFn` runs tracked, as a
 * computation whose value is discarded — what it READS is the point. Every
 * run after the first is a notification (a source it read was written, went
 * pending, or landed; an optimistic write notifies like any other) and
 * queues the boundary for re-arming once this pass's heap has run
 * (scheduler.ts `pendingRearms`: the re-arm needs what the notifying write
 * put in flight, which this pass — at the height of its reads — runs ahead
 * of). The value is never compared: a thunk that returns a fresh object per
 * run but reads nothing reactive never re-arms, and one that returns the
 * same constant re-arms whenever a read source changes. A zero-argument
 * function is an accessor, tracked like any other.
 *
 * The pass's posture is the notification's: a plain pass derived from the
 * frame the write belongs to (the committed one, or a transaction's staged
 * one — this pass runs under it), and the re-arm follows that frame. A pass
 * under a lane read display-ahead state — `latest()` (its shadow is an
 * optimistic computed), an optimistic write — and the re-arm shows the
 * fallback ahead too, now, beside whatever frame a transaction still holds
 * (`_rearmAhead`; the mainline drain).
 *
 * Created under `owner` while the owner's queue is still the parent's, so
 * the node belongs to the parent boundary, not to this one — as the
 * condition of a `<Show>` wrapping the boundary would. Two status rules set
 * it apart from a plain memo:
 * - Pending is not the parent's: a source of `on` that is not ready is a
 *   notification for this boundary (it re-arms: the fallback shows here, not
 *   in an outer boundary). Propagation marks the node without a pass, so the
 *   channel scrubs the mark and re-derives it; the pass reads the source
 *   (linking to its landing) and catches. The node never registers as a
 *   reporter: `on` reading a pending source holds no frame.
 * - An error IS the parent's, as a wrapping `<Show>` condition's would be:
 *   forwarded up the queue chain like a render effect's; uncaught, it halts
 *   (#2884).
 */
function onNode(owner: Owner, queue: CollectionQueue, onFn: () => any): Computed<unknown> {
  let mounted = false;
  const node = runWithOwner(owner, () =>
    computed<unknown>(
      () => {
        try {
          onFn();
        } catch (e) {
          if (!(e instanceof NotReadyError)) throw e;
        }
        if (mounted) {
          if (currentOptimisticLane !== null) queue._rearmAhead = true;
          queueRearm(queue);
        } else mounted = true;
      },
      { lazy: true }
    )
  );
  ext(node)._notifyStatus = (status?: number, error?: any) => {
    const flags = status !== undefined ? status : node._statusFlags;
    if (flags & STATUS_PENDING) {
      node._statusFlags &= ~STATUS_PENDING;
      if (node._x?._error instanceof NotReadyError) node._x._error = undefined;
      enqueueSub(node);
      schedule();
    }
    if (flags & STATUS_ERROR) {
      const actualError = error !== undefined ? error : node._x?._error;
      node._statusFlags &= ~STATUS_ERROR;
      if (node._x?._error === actualError && node._x !== null) node._x._error = undefined;
      if (!node._queue.notify(node, STATUS_ERROR, flags, actualError)) {
        haltReactivity(unwrapStatusError(actualError));
        throw actualError;
      }
    }
  };
  node._config &= ~CONFIG_AUTO_DISPOSE;
  recompute(node, true);
  return node;
}

function createBoundChildren<T>(
  owner: Owner,
  fn: () => T,
  queue: IQueue,
  mask: number
): Computed<T> {
  const parentQueue = owner._queue;
  parentQueue.addChild((owner._queue = queue));
  cleanup(() => parentQueue.removeChild(owner._queue!));
  return runWithOwner(owner, () => {
    const c = computed(fn);
    return boundaryComputed(() => flatten(read(c)), mask);
  });
}

const RevealControllerContext = /* @__PURE__ */ createContext<RevealController | null>(null);
let _revealUsed = false;

type RevealSlot = CollectionQueue | RevealController;
type BoolAccessor = () => boolean;
export type RevealOrder = "sequential" | "together" | "natural";
type OrderAccessor = () => RevealOrder;
const FALSE_ACCESSOR: BoolAccessor = () => false;
const SEQUENTIAL_ACCESSOR: OrderAccessor = () => "sequential";

function isRevealController(slot: RevealSlot): slot is RevealController {
  return slot instanceof RevealController;
}

function isSlotReady(slot: RevealSlot): boolean {
  return isRevealController(slot) ? slot._isReady() : slot._sources.size === 0 && !slot._pending;
}

function isSlotMinimallyReady(slot: RevealSlot): boolean {
  return isRevealController(slot) ? slot._isMinimallyReady() : isSlotReady(slot);
}

function setSlotState(
  slot: RevealSlot,
  controller: RevealController,
  disabled: boolean,
  collapsed: boolean
): void {
  setSignal(slot._disabled, disabled);
  setSignal(slot._collapsed, collapsed);
  if (isRevealController(slot)) {
    if (!disabled && slot._parentController === controller) slot._parentController = undefined;
    return slot._evaluate(disabled, collapsed);
  }
  if (!disabled && slot._revealController === controller && slot._initialized)
    slot._revealController = undefined;
}

export class RevealController {
  _orderAccessor: OrderAccessor;
  _collapsedAccessor: BoolAccessor;
  _slots: RevealSlot[] = [];
  _parentController?: RevealController;
  _disabled: Signal<boolean> = signal(false, { ownedWrite: true, _noSnapshot: true });
  _collapsed: Signal<boolean> = signal(false, { ownedWrite: true, _noSnapshot: true });
  _ready = true;
  _minimallyReady = true;
  _evaluating = false;

  constructor(order: OrderAccessor, collapsed: BoolAccessor) {
    this._orderAccessor = order;
    this._collapsedAccessor = collapsed;
  }

  _forEachOwnedSlot(fn: (slot: RevealSlot) => boolean | void): boolean {
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      if ((isRevealController(slot) ? slot._parentController : slot._revealController) !== this)
        continue;
      if (fn(slot) === false) return false;
    }
    return true;
  }

  _isReady(): boolean {
    return this._forEachOwnedSlot(isSlotReady);
  }

  /**
   * "Minimally ready" = this group has something visible to show under its own policy.
   * Used by an enclosing `together` group to decide when it can release.
   * - `together`: every direct slot is minimally ready.
   * - `sequential`: the first owned slot is minimally ready (frontier can advance).
   * - `natural`: any owned slot is minimally ready.
   */
  _isMinimallyReady(): boolean {
    const order = untrack(this._orderAccessor);
    if (order === "together") return this._forEachOwnedSlot(isSlotMinimallyReady);
    if (order === "natural") {
      let hasSlot = false;
      let anyReady = false;
      this._forEachOwnedSlot(slot => {
        hasSlot = true;
        if (isSlotMinimallyReady(slot)) {
          anyReady = true;
          return false;
        }
      });
      return !hasSlot || anyReady;
    }
    // sequential: only the first owned slot matters.
    let firstReady = true;
    this._forEachOwnedSlot(slot => {
      firstReady = isSlotMinimallyReady(slot);
      return false;
    });
    return firstReady;
  }

  _register(slot: RevealSlot): void {
    if (this._slots.includes(slot)) return;
    this._slots.push(slot);
    const order = untrack(this._orderAccessor);
    (setSignal(slot._disabled, true),
      setSignal(
        slot._collapsed,
        order === "sequential" ? !!untrack(this._collapsedAccessor) : false
      ));
    untrack(() => this._evaluate());
  }

  _unregister(slot: RevealSlot): void {
    const index = this._slots.indexOf(slot);
    if (index >= 0) this._slots.splice(index, 1);
    untrack(() => this._evaluate());
  }

  _evaluate(disabledOverride?: boolean, collapsedOverride?: boolean): void {
    if (this._evaluating) return;
    this._evaluating = true;
    const wasReady = this._ready;
    const wasMinReady = this._minimallyReady;
    try {
      const disabled = disabledOverride ?? read(this._disabled),
        order = untrack(this._orderAccessor),
        collapseTail = order === "sequential" && !!untrack(this._collapsedAccessor),
        collapsed = collapsedOverride ?? collapseTail;
      if (disabled) {
        // Held by an outer group. Propagate the hold (and whatever collapsed policy
        // the outer asked for) down the whole subtree. Inner order is ignored while
        // held; it resumes once the outer releases us.
        this._forEachOwnedSlot(slot => setSlotState(slot, this, true, collapsed));
      } else if (order === "natural") {
        // Each child reveals based on its own readiness. A nested controller slot
        // is released to run its own order locally — we bypass setSlotState for it
        // so the parent backpointer survives for upward readiness notifications.
        this._forEachOwnedSlot(slot => {
          if (isRevealController(slot)) {
            setSignal(slot._collapsed, false);
            setSignal(slot._disabled, false);
            slot._evaluate(false, false);
          } else {
            setSlotState(slot, this, !isSlotReady(slot), false);
          }
        });
      } else if (order === "together") {
        // Release when every direct slot is minimally ready (has something to show
        // under its own order). A fully-ready inner together is minimally ready;
        // sequential's first slot being ready is minimally ready; natural having any
        // ready child is minimally ready. This lets `together` guarantee a single
        // cohesive reveal without waiting for every grandchild.
        const minReady = this._forEachOwnedSlot(isSlotMinimallyReady);
        this._forEachOwnedSlot(slot => setSlotState(slot, this, !minReady, false));
      } else {
        let pendingSeen = false;
        this._forEachOwnedSlot(slot => {
          if (pendingSeen) return setSlotState(slot, this, true, collapseTail);
          if (isSlotReady(slot)) return setSlotState(slot, this, false, false);
          pendingSeen = true;
          // Frontier slot. For a leaf, holding `_disabled=true` is what keeps its
          // fallback visible. For a composite, we instead release it so it runs
          // its own order locally — its leaves will each show their own fallback
          // until their data lands. Outer still waits on full readiness before
          // advancing past this slot, and we bypass setSlotState so the parent
          // backpointer survives for upward readiness notifications.
          if (isRevealController(slot)) {
            setSignal(slot._collapsed, false);
            setSignal(slot._disabled, false);
            slot._evaluate(false, false);
          } else {
            setSlotState(slot, this, true, false);
          }
        });
      }
    } finally {
      this._ready = this._isReady();
      this._minimallyReady = this._isMinimallyReady();
      this._evaluating = false;
    }
    if (
      this._parentController &&
      (wasReady !== this._ready || wasMinReady !== this._minimallyReady)
    )
      this._parentController._evaluate();
  }
}

export class CollectionQueue extends Queue {
  _collectionType: number;
  _sources: Set<Computed<any>> = new Set();
  _tree?: BoundaryComputed<any>;
  _pending = true;
  _disabled: Signal<boolean> = signal(false, { ownedWrite: true, _noSnapshot: true });
  _error?: Signal<unknown>;
  _collapsed: Signal<boolean> = signal(false, { ownedWrite: true, _noSnapshot: true });
  _revealController?: RevealController;
  _initialized: boolean = false;
  /** The boundary's owner — where a `caught` report locates itself, set before the children are built (a creation-time throw arrives before `_tree`). */
  _owner?: Owner;
  /** The `on` pass that queued this re-arm ran under a lane (onNode): the
   * fallback swap is display-ahead — the mainline drain's, not the frame's. */
  _rearmAhead = false;
  /** Released before the verdict with the swap deferred (`_rearmAhead`):
   * the mainline drain owes the boundary its fallback. */
  _swapOwed = false;
  /** DEV: a frame-following swap is staged and not yet reported unseen
   * (`_devHeldSweep`; cleared by the sweep that settles or clears it). */
  _swapUnseen = false;
  constructor(type: number) {
    super();
    this._collectionType = type;
  }
  run(type: number) {
    if (!type || (read(this._disabled) && (!_revealUsed || read(this._collapsed)))) return;
    return super.run(type);
  }
  /** An `on` dependency notified (onNode → scheduler `pendingRearms`), and
   * this is one of the flush's two drains (#3540): before the verdict
   * (`mainline` false — under the transaction the notifying write belongs
   * to, so a write here is staged with its frame) or at the finalize
   * (`mainline` true — past any park, so a write here is the current
   * frame's). Re-arming means, for what the boundary currently shows:
   * - content (a loading boundary that revealed, `_initialized`): the
   *   boundary is fresh again — its fallback, if anything under it is still
   *   pending; nothing at all otherwise (no fallback flash for a
   *   notification that finds nothing to wait on). The release is
   *   immediate: the boundary stops holding the frame, whatever it shows.
   *   The fallback swap FOLLOWS THE FRAME the notification belongs to: it
   *   lands with the write's commit — now, when nothing else holds it;
   *   together with the rest of the new page when something outside the
   *   boundary does — never beside the old page for a change nothing on
   *   screen reflects yet. If the pending lands before that frame commits,
   *   the sweep (`_checkSources`) clears the swap ahead of the commit and no
   *   fallback is ever shown. The exception is a display-ahead notification
   *   (`_rearmAhead`: `on` read `latest()` or an optimistic write): the
   *   user asked for the change now, and the swap is the mainline drain's —
   *   the fallback shows now, beside the frame the transaction still holds.
   *   The children stay alive behind the fallback (`_disabled` hides the
   *   output; nothing is disposed or re-created) and reveal again when the
   *   pending lands.
   * - its error fallback (an error boundary holding caught failures): the
   *   failures are retried, exactly as the fallback's `reset()` would —
   *   reset keys. The boundary reveals if the retry succeeds. Mainline: a
   *   retry is a recompute, not a display write — content now, the action's
   *   other writes later.
   * - its loading fallback already: nothing to re-arm.
   * A boundary disposed since the notification is skipped. */
  _rearm(mainline: boolean): void {
    const ahead = this._rearmAhead;
    this._rearmAhead = false;
    if (this._tree === undefined || this._tree._flags & REACTIVE_DISPOSED) return;
    if (this._collectionType & STATUS_ERROR) {
      if (!mainline) queueRearm(this);
      else if (this._sources.size) this._retry();
      return;
    }
    if (!this._initialized) {
      if (mainline && this._swapOwed) this._swap();
      return;
    }
    // Readers forwarded while this boundary showed content are what it
    // would wait on now. They never re-notify (status propagation dedupes on
    // the reader's `_pendingSources`), so the re-arm collects it from their
    // registrations — the one place a forwarded reader is recorded (INV-3)
    // — or a sibling reader's flight that lands first reveals them stale
    // (A33, #3459). Before the verdict, a registration may have stopped
    // counting without being pruned yet (its flight landed this pass):
    // `reporterBlocksSource` is the verdict's own test.
    const sources = new Set<Computed<any>>();
    let outside: Computed<any> | undefined;
    for (const t of transitions)
      for (const [source, reporters] of t._asyncReporters) {
        let held = false;
        for (const reporter of reporters)
          if (this._holds(reporter) && reporterBlocksSource(reporter, source)) {
            held = true;
            sources.add(source);
            reporter._x?._pendingSources?.forEach(s => sources.add(s));
          }
        // DEV: the same source is also awaited by a live reporter OUTSIDE
        // this boundary — one whose hold the frame keeps, so the frame (and
        // the swap with it) waits for the source and the fallback is never
        // seen (LOADING_ON_OUTSIDE_HOLD below). Not for a display-ahead
        // re-arm: that fallback shows now by the user's choice.
        if (__DEV__ && held && !ahead && outside === undefined)
          for (const reporter of reporters)
            if (!this._holds(reporter) && reporterBlocksSource(reporter, source)) {
              outside = source;
              break;
            }
      }
    if (!sources.size) return;
    if (__DEV__ && outside !== undefined) {
      const name = (outside as any)._name as string | undefined;
      this._reportUnseen(
        `${
          name ? `\`${name}\`` : "a source it is waiting on"
        } is also read outside it and holds the frame: the fallback lands with the frame and will not be seen until that read settles. ` +
          "Read `latest()` in `on` to show the fallback now, or move the outside read under the boundary.",
        name
      );
    }
    this._initialized = false;
    this._sources = sources;
    this._pending = true;
    // Ahead of the verdict a write lands in the notifying write's frame:
    // that is the swap's place — unless the notification was display-ahead,
    // whose swap the mainline drain makes (`_swapOwed`).
    if (ahead && !mainline) {
      this._swapOwed = true;
      queueRearm(this);
    } else {
      // DEV: a frame-following swap the source rule did not already report
      // is watched by the parked sweep (`_devHeldSweep`) — one report per
      // re-arm, whichever rule sees it first.
      if (__DEV__) this._swapUnseen = !ahead && !mainline && outside === undefined;
      this._swap();
    }
    // Those readers are behind the fallback now: they stop blocking
    // (`reporterBlocksSource`), and the transactions they were holding must
    // be re-judged for it (A33, #3375) — the active one by the verdict that
    // follows this drain, parked ones by the wake. A live action keeps its
    // transaction parked regardless (transitionComplete): its batch commits
    // when it settles, intact.
    wakeParked();
  }
  /** DEV: LOADING_ON_OUTSIDE_HOLD — a frame-following re-arm whose fallback
   * the user will not see, with the reason (`detail`) and the fix. */
  _reportUnseen(detail: string, name?: string): void {
    if (!__DEV__) return;
    reportDiagnostic(
      emitDiagnostic(
        {
          code: "LOADING_ON_OUTSIDE_HOLD",
          kind: "async",
          severity: "warn",
          message: `[LOADING_ON_OUTSIDE_HOLD] \`on\` re-armed a Loading boundary, but ${detail}`,
          nodeName: name,
          data: { source: name }
        },
        this._owner
      )
    );
  }
  /** DEV, a parked finalize (scheduler `checkBoundaryChildren`): the
   * after-the-fact LOADING_ON_OUTSIDE_HOLD rule. The re-arm's swap is still
   * staged (`_disabled` holds `true` uncommitted) and the content it was
   * waiting on has settled — the sweep that follows the commit will clear it
   * before any effect phase runs, so the fallback is never displayed. That
   * is the design when other data holds the frame (a race the fallback may
   * still win: the shell landing first shows it); it is the missed case when
   * nothing but the write's own action (or an override it left) parks the
   * transaction — the action outlasts the data, and `on` never shows a
   * fallback. The source rule in `_rearm` cannot see this: nothing outside
   * the boundary reads the source. */
  _devHeldSweep(): void {
    if (!__DEV__ || !this._swapUnseen || this._disabled._pendingValue !== true) return;
    for (const source of this._sources) if (!this._settled(source)) return;
    const t = this._disabled._transition;
    if (t === null) return;
    for (const [source, reporters] of currentTransition(t)._asyncReporters)
      for (const reporter of reporters) if (reporterBlocksSource(reporter, source)) return;
    this._swapUnseen = false;
    this._reportUnseen(
      "the frame was held until its content settled, so the fallback was never displayed. " +
        "Read `latest()` in `on` to show the fallback immediately."
    );
  }
  /** Show the fallback: the swap the output pass selects on. Lands where it
   * is written — in the active transaction's frame, or the current one. */
  _swap(): void {
    this._swapOwed = false;
    setSignal(this._disabled, true);
    if (__OBSERVE__ && attrHooks !== null) attrHooks.boundaryFallback(this, this._tree!, true);
  }
  /** Retry the collected failures of an error boundary: recompute each
   * source that threw, so the boundary can recover. */
  _retry(): void {
    for (const source of this._sources) {
      // Non-computed sources (patch-channel registrations under plain
      // owners) are not recomputable — their reset is the record's next
      // transition re-applying the patch (re-audit 2, P1-4).
      if ((source as any)._fn !== undefined) recompute(source);
    }
    schedule();
  }
  notify(node: Effect<any>, type: number, flags: number, error?: any) {
    if (!(type & this._collectionType)) return super.notify(node, type, flags, error);

    // Routing is dimension-independent: each boundary consumes only its own
    // status dimension from the mask (`type &= ~collectionType` below) and
    // forwards the remainder up the queue chain. An error inside a `Loading`
    // needs no special rule — the ERROR dimension survives consumption here and
    // reaches the `Errored` that catches it natively, and `flags & collectionType`
    // keeps this boundary from collecting a node that isn't actually pending.
    // Symmetrically, a pending inside an `Errored` forwards on the PENDING
    // dimension, while a status already caught by an inner boundary arrives with
    // its dimension consumed from the mask and is correctly not re-routed
    // (the Loading > Errored > content composition escape, #2856).
    if (this._collectionType & STATUS_PENDING && this._initialized)
      return super.notify(node, type, flags, error);

    if (flags & this._collectionType) {
      this._pending = true;
      const source = (error as any)?.source || (node._x?._error as any)?.source;
      if (source) {
        const wasEmpty = this._sources.size === 0;
        this._sources.add(source);
        // A collecting boundary waits on everything the effect is pending on,
        // not only the source this notification carries. Status propagation
        // dedupes on the effect's `_pendingSources`: a source it already
        // carries (a flight that started before an `on` reset cleared the
        // set) is never re-reported, and that source's later re-flight
        // stays invisible — the boundary revealed when its one collected
        // source settled while the effect was still pending (#3375).
        if (this._collectionType & STATUS_PENDING)
          node._x?._pendingSources?.forEach(s => this._sources.add(s));
        if (wasEmpty) {
          setSignal(this._disabled, true);
          if (__OBSERVE__ && attrHooks !== null && this._collectionType & STATUS_PENDING)
            attrHooks.boundaryFallback(this, this._tree, true);
        }
        if (this._collectionType & STATUS_ERROR) {
          const caught = unwrapStatusError(source._x?._error);
          setSignal(this._error!, caught);
          // The client error hook: this boundary renders its fallback for
          // it — the one road a rendered failure took that no global handler
          // ever saw. `source` is the computation that threw (the status
          // wrapper's, made at the first landing and kept downstream), so the
          // hook hears where it broke as well as where it was met. Once per
          // error object; a `reset()` re-collecting the same failure says
          // nothing new.
          reportClientError(caught, this._owner, source);
        }
      }
    }
    type &= ~this._collectionType;
    return type ? super.notify(node, type, flags, error) : true;
  }
  /** Is `reporter` live and routed to this boundary — under it, with no
   * collecting pending-type boundary in between (`reporterBlocksSource`'s test)? */
  _holds(reporter: Computed<any>): boolean {
    if (reporter._flags & (REACTIVE_ZOMBIE | REACTIVE_DISPOSED)) return false;
    for (let q: IQueue | null = reporter._queue; q; q = q._parent) {
      if (q === this) return true;
      if (q._collectionType! & STATUS_PENDING && !q._initialized) return false;
    }
    return false;
  }
  /** Has a collected source stopped counting for this boundary? A source
   * with a live affects() mark holds display state for the mark's lifetime
   * (the visual channel): the marked node carries no status of its own, so
   * the count is the liveness test. The release sweep (finalizePureQueue
   * after mark release) re-runs this check. A source born held under this
   * boundary (recompute, #3540) carries no status either: it is collected
   * while it has a staged value and no committed one, and released by the
   * commit that initializes it. */
  _settled(source: Computed<any>): boolean {
    return !!(
      source._flags & REACTIVE_DISPOSED ||
      (!source._x?._affectsCount &&
        !(source._statusFlags & this._collectionType) &&
        !(this._collectionType & STATUS_ERROR && source._statusFlags & STATUS_PENDING) &&
        !(
          this._collectionType & STATUS_PENDING &&
          source._statusFlags & STATUS_UNINITIALIZED &&
          source._pendingValue !== NOT_PENDING
        ))
    );
  }
  _checkSources() {
    for (const source of this._sources) if (this._settled(source)) this._sources.delete(source);
    if (!this._sources.size) {
      if (
        this._collectionType & STATUS_PENDING &&
        this._pending &&
        !this._initialized &&
        this._tree
      ) {
        this._pending = !!(this._tree._statusFlags & this._collectionType);
      } else {
        this._pending = false;
      }
      if (!this._pending) {
        if (__DEV__) this._swapUnseen = false; // the swap ran its course (`_devHeldSweep`)
        setSignal(this._disabled, false);
        if (__OBSERVE__ && attrHooks !== null && this._collectionType & STATUS_PENDING)
          attrHooks.boundaryFallback(this, this._tree, false);
      }
    }
    if (_revealUsed) this._revealController?._evaluate();
  }
}

function createCollectionBoundary<T>(
  type: number,
  fn: () => T,
  fallback: (queue: CollectionQueue) => T,
  onFn?: () => any
): Accessor<T> {
  if (__DEV__ && !getOwner()) {
    const message =
      "[NO_OWNER_BOUNDARY] Boundaries created outside a reactive context will never be disposed.";
    reportDiagnostic(
      emitDiagnostic({
        code: "NO_OWNER_BOUNDARY",
        kind: "lifecycle",
        severity: "warn",
        message,
        data: { boundaryType: type === STATUS_PENDING ? "loading" : "error" }
      })
    );
  }
  const owner = createOwner();
  if (_revealUsed) setContext(RevealControllerContext, null, owner);
  const queue = new CollectionQueue(type);
  queue._owner = owner;
  if (type === STATUS_ERROR)
    queue._error = signal<unknown>(undefined, { ownedWrite: true, _noSnapshot: true });
  // The `on` dependencies live OUTSIDE the boundary, as the condition of a
  // `<Show>` wrapping it would: created before the owner's queue becomes
  // this boundary's (onNode).
  onFn && onNode(owner, queue, onFn);
  const tree = (queue._tree = createBoundChildren(owner, fn, queue, type) as BoundaryComputed<any>);
  // Prime source tracking so reveal registration sees pending sources. A
  // bookkeeping read (`spectate`): the mounting pass derives nothing from
  // the tree — it must not be linked to it, nor enter the transaction a
  // tree born held (A29 under a boundary, #3540) was staged into.
  spectate(() => {
    let pending = false;
    try {
      read(tree);
    } catch (e) {
      if (e instanceof NotReadyError) pending = true;
      else throw e;
    }
    queue._pending =
      pending || !!(tree._statusFlags & type) || tree._x?._error instanceof NotReadyError;
  });
  const controller =
    _revealUsed && type === STATUS_PENDING ? getContext(RevealControllerContext) : null;
  if (controller) {
    queue._revealController = controller;
    controller._register(queue);
    cleanup(() => controller._unregister(queue));
  }
  return accessor<T>(
    computed(
      (): T => {
        // `_disabled` selects fallback or content: set by a collecting
        // notification or a re-arm (`_rearm`), cleared by the sweep when the
        // collected sources settle — each re-runs this pass.
        if (!read(queue._disabled)) {
          const resolved = read(tree);
          if (!untrack(() => read(queue._disabled))) return ((queue._initialized = true), resolved);
        }
        // Collapsed reveal slots suppress their own output entirely; the
        // renderer treats the hole as empty, so the cast never leaks to users
        // outside a `createRevealOrder` scope.
        if (_revealUsed && read(queue._collapsed)) return undefined as T;
        return fallback(queue);
      },
      // Boundary structure, not a user source: its value is fallback-or-content and
      // legitimately swaps mid-hydration (reveal/resume), so it must never be frozen
      // by snapshot capture. The tree no longer carries foreign status flags, so
      // capture can't rely on PENDING to skip this node the way it used to.
      { _noSnapshot: true }
    )
  );
}

/**
 * Lower-level primitive that backs the `<Loading>` flow control. Catches
 * pending async reads inside `fn` and renders `fallback` until they settle.
 *
 * App code should use `<Loading fallback={...}>` instead — reach for this only
 * when authoring custom boundary components.
 *
 * @param fn the tracked subtree
 * @param fallback the fallback shown while async reads in `fn` are unresolved
 * @param options `on` — a dependency list: a tracked function whose reads
 *   re-arm the boundary. Its return value is irrelevant (never compared);
 *   what matters is what it reads. Without `on`, a boundary that has shown
 *   content keeps it through a refetch (the pending holds with the
 *   transaction). With `on`, a write to anything it reads makes the boundary
 *   fresh again: it stops waiting on its current content, and if something
 *   under it is pending it shows `fallback` until the new content is ready;
 *   if nothing is pending, the notification is a no-op. The fallback lands
 *   with the same frame as the change that caused it — now, when nothing
 *   else holds that frame; together with the rest of the new page during a
 *   held navigation, not before it. Read `latest()` in `on` to show the
 *   fallback immediately, beside the still-held frame. If the same data is
 *   also read outside the boundary, the frame waits on it and no fallback
 *   appears (DEV warns `LOADING_ON_OUTSIDE_HOLD`). Optimistic writes and a
 *   source going pending notify like any other. The children are not
 *   re-created — they stay alive behind the fallback.
 *
 * @example
 * ```tsx
 * // Custom boundary component built on top of the primitive.
 * function MyLoading(props: { fallback: JSX.Element; children: JSX.Element }) {
 *   return createLoadingBoundary(
 *     () => props.children,
 *     () => props.fallback
 *   ) as unknown as JSX.Element;
 * }
 * ```
 */
export function createLoadingBoundary<T, U>(
  fn: () => T,
  fallback: () => U,
  options?: { on?: () => any }
): Accessor<T | U> {
  return createCollectionBoundary<T | U>(STATUS_PENDING, fn, () => fallback(), options?.on);
}

/**
 * Lower-level primitive that backs the `<Errored>` flow control. Catches
 * thrown errors inside `fn` and invokes `fallback(error, reset)` instead.
 * `error` is an accessor for the latest captured error; `reset()` recomputes
 * the failing sources so the boundary can attempt to recover.
 *
 * App code should use `<Errored fallback={...}>` instead — reach for this only
 * when authoring custom boundary components.
 *
 * @param options `on` — a dependency list, as for `createLoadingBoundary`: a
 *   tracked function whose reads re-arm the boundary (its value is
 *   irrelevant). While the boundary shows its error fallback, a write to
 *   anything `on` reads retries the failed computations, exactly as the
 *   fallback's `reset()` does — reset keys. With nothing caught, the
 *   notification is a no-op.
 *
 * @example
 * ```tsx
 * // Custom boundary that wraps the primitive and adds telemetry.
 * function TracedErrored(props: { fallback: (e: () => unknown) => JSX.Element; children: JSX.Element }) {
 *   return createErrorBoundary(
 *     () => props.children,
 *     (err, reset) => {
 *       reportError(err());
 *       return props.fallback(err);
 *     }
 *   ) as unknown as JSX.Element;
 * }
 * ```
 */
export function createErrorBoundary<T, U>(
  fn: () => T,
  fallback: (error: Accessor<unknown>, reset: () => void) => U,
  options?: { on?: () => any }
): Accessor<T | U> {
  return createCollectionBoundary<T | U>(
    STATUS_ERROR,
    fn,
    queue => fallback(accessor(queue._error), () => queue._retry()),
    options?.on
  );
}

/**
 * Coordinate the reveal timing of sibling loading boundaries.
 *
 * Accepts reactive accessors:
 * - `order`: `"sequential"` (default) | `"together"` | `"natural"`.
 *   - `"sequential"` — classic frontier reveal: siblings reveal in registration order
 *     as each resolves; later siblings stay hidden until earlier ones complete.
 *   - `"together"` — every direct slot stays on its fallback until the whole group
 *     is "minimally ready" (each direct slot has produced its own first visible
 *     content under its own order), then the whole group releases at once.
 *   - `"natural"` — children reveal independently (as each resolves). At the top
 *     level this is a no-op compared to not using `createRevealOrder`; the mode
 *     exists for nesting, where the group registers as a single composite slot to
 *     any enclosing `createRevealOrder`.
 * - `collapsed`: only meaningful when `order === "sequential"`. When set, tail siblings
 *   past the frontier suppress their own fallback output. Ignored under `"together"`
 *   and `"natural"` — those orders have no frontier.
 *
 * Nested `createRevealOrder` groups compose: the inner controller registers as a
 * single slot in the outer controller and is held on its fallbacks until the outer
 * releases that slot. Once released, the inner controller runs its own order locally
 * over anything still pending. There is no opt-out from an outer hold.
 *
 * "Minimally ready" is what an order considers its first visible content:
 * - `sequential` — frontier-0 is minimally ready (leaf: on resolve; nested: via its
 *   own minimal signal).
 * - `together` — every direct slot is minimally ready.
 * - `natural` — any direct slot has visible content (leaves on resolve; nested
 *   composites via their own minimal signal).
 *
 * @example
 * ```ts
 * // Primitive form of `<Reveal>` — coordinate sibling loading boundaries
 * // programmatically. App code uses the JSX `<Reveal>` component instead.
 * // Both options are accessors so they can react to state changes.
 * createRevealOrder(
 *   () => renderSiblings(),
 *   { order: () => mode(), collapsed: () => true }
 * );
 * ```
 */
export function createRevealOrder<T>(
  fn: () => T,
  options?: { order?: OrderAccessor; collapsed?: BoolAccessor }
): T {
  _revealUsed = true;
  const owner = createOwner();
  const parentController = getContext(RevealControllerContext);
  const order = options?.order || SEQUENTIAL_ACCESSOR,
    collapsed = options?.collapsed || FALSE_ACCESSOR;
  const controller = new RevealController(order, collapsed);
  setContext(RevealControllerContext, controller, owner);
  return runWithOwner(owner, () => {
    const value = fn();
    computed(() => {
      order();
      collapsed();
      controller._evaluate();
    });
    if (parentController) {
      controller._parentController = parentController;
      parentController._register(controller);
      cleanup(() => parentController._unregister(controller));
    }
    return value;
  });
}

/**
 * Resolves a children value to its renderable form: unwraps zero-arg functions
 * (accessors), recursively flattens arrays, and optionally skips
 * non-rendering values (`null`, `undefined`, `true`, `false`, `""`).
 *
 * Used internally by flow components and by the renderer to walk a children
 * tree. App code rarely needs this directly — see `children()` in `solid-js`
 * for the user-facing helper that memoizes the result.
 *
 * @param children value or array of values to flatten
 * @param options
 *   - `skipNonRendered` — drop values that won't render
 *   - `doNotUnwrap` — leave function children as-is (caller will resolve)
 *
 * @example
 * ```ts
 * // Custom renderer walking a children tree manually. Most authors should
 * // use `children()` from solid-js, which memoizes the resolved value.
 * function renderChildren(value: unknown): unknown {
 *   return flatten(value, { skipNonRendered: true });
 * }
 * ```
 */
export function flatten(
  children: any,
  options?: { skipNonRendered?: boolean; doNotUnwrap?: boolean }
): any {
  if (typeof children === "function" && !children.length) {
    if (options?.doNotUnwrap) return children;
    do {
      children = children();
    } while (typeof children === "function" && !children.length);
  }
  if (
    options?.skipNonRendered &&
    (children == null || children === true || children === false || children === "")
  )
    return;

  if (Array.isArray(children)) {
    let results: any[] = [];
    if (flattenArray(children, results, options)) {
      return () => {
        let nested = [];
        flattenArray(results, nested, { ...options, doNotUnwrap: false });
        return nested;
      };
    }
    return results;
  }
  return children;
}

function flattenArray(
  children: Array<any>,
  results: any[] = [],
  options?: { skipNonRendered?: boolean; doNotUnwrap?: boolean }
): boolean {
  let notReady: NotReadyError | null = null;
  let needsUnwrap = false;
  for (let i = 0; i < children.length; i++) {
    try {
      let child = children[i];
      if (typeof child === "function" && !child.length) {
        if (options?.doNotUnwrap) {
          results.push(child);
          needsUnwrap = true;
          continue;
        }
        do {
          child = child();
        } while (typeof child === "function" && !child.length);
      }
      if (Array.isArray(child)) {
        // OR, don't overwrite: an accessor already pushed under doNotUnwrap
        // still needs the resolving wrapper even when a later sibling
        // fragment contains no functions (#3133).
        needsUnwrap = flattenArray(child, results, options) || needsUnwrap;
      } else if (
        options?.skipNonRendered &&
        (child == null || child === true || child === false || child === "")
      ) {
        // skip
      } else results.push(child);
    } catch (e) {
      if (!(e instanceof NotReadyError)) throw e;
      notReady = e;
    }
  }
  if (notReady) throw notReady;
  return needsUnwrap;
}
