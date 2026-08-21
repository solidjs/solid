import type { NOT_PENDING } from "./constants.js";
import type { OptimisticLane } from "./lanes.js";
import type { IQueue, Transition } from "./scheduler.js";

export interface Disposable {
  (): void;
}
export interface Link {
  _dep: Signal<unknown> | Computed<unknown>;
  _sub: Computed<unknown>;
  _nextDep: Link | null;
  _prevSub: Link | null;
  _nextSub: Link | null;
  /**
   * `_sub._depGen` at the time this link was created or last revalidated
   * in-order. A link stamped with the subscriber's current pass generation is
   * inside the validated `[deps.._depsTail]` prefix — an O(1) replacement for
   * scanning the dep list to answer membership (see `link()`).
   */
  _gen: number;
  // True when the link was created by an `isPending` read. Such a link observes
  // the dep's pending state only: `notifyStatus` re-runs the subscriber on a
  // real (non-NotReadyError) error instead of propagating the error through it,
  // matching the synchronous `isPending` read which swallows such errors.
  _pendingObserver?: boolean;
}

export interface NodeOptions<T> {
  id?: string;
  name?: string;
  transparent?: boolean;
  equals?: ((prev: T, next: T) => boolean) | false;
  ownedWrite?: boolean;
  /** Exclude this signal from snapshot capture (internal — not part of public API) */
  _noSnapshot?: boolean;
  unobserved?: () => void;
  lazy?: boolean;
  sync?: boolean;
  /**
   * Commit #0. When present (checked with `in`, so an explicit `undefined`
   * counts), the node is born committed with this value instead of
   * STATUS_UNINITIALIZED: reads serve it everywhere, nothing suspends to
   * Loading boundaries, transitions are never held, and the window is
   * verdict-quiet (`isPending` stays false — commit #0 answers the question
   * by declaration; first-load affordances live in the value itself). After
   * the first real answer lands, normal refetch/pending semantics apply.
   */
  loadingValue?: T;
}

/**
 * Cold node extension (stage-3 §12): optional machinery that most nodes
 * never touch lives one hop away so the CORE node literal stays under V8's
 * in-object property boundary (~39 fields measured: past it, every literal
 * allocation spills to an out-of-object backing store and creation cost
 * roughly quadruples — the create0to1 cliff). Allocated lazily by `ext()`
 * on first installer write; ONE shape shared by signals and computeds so
 * `_x` access stays monomorphic. Presence bits on `_config`
 * (CONFIG_OPTIMISTIC / HAS_COMPANIONS / HAS_LANE / HAS_SNAPSHOT) remain the
 * hot-path gates — a bit says "consult _x", never the reverse.
 */
export interface NodeExtension {
  _transition: Transition | null;
  _overrideValue: unknown | typeof NOT_PENDING;
  /**
   * The transaction that owns the active override (stamped at optimistic
   * write, cleared at settle). Ownership must live on the node: a lane's
   * _transition is a scheduling affinity that a shared subscriber can merge
   * across transactions (#2912) — following it would let one action's settle
   * revert another action's live override. Node-level sibling of the store
   * layer's STORE_OPTIMISTIC_OWNERS stamps (#2899). `null` = ambient write.
   */
  _overrideOwner: Transition | null | undefined;
  _optimisticLane: OptimisticLane | undefined;
  _pendingSignal: Signal<boolean> | undefined; // Lazy signal for isPending()
  _latestValueComputed: Computed<any> | undefined; // Lazy computed for latest()
  _parentSource: Signal<any> | Computed<any> | undefined; // Back-reference for parent-child lane relationship
  /**
   * Live `affects()` marks on this node (refcount). Non-zero is declared
   * motion — see affects(); the count is the mark's only graph state.
   */
  _affectsCount: number;
  _inFlight: PromiseLike<any> | AsyncIterable<any> | null;
  _error: unknown;
  _blocked: boolean | undefined;
  _pendingSources: Set<Computed<any>> | undefined;
  _notifyStatus: ((status?: number, error?: any) => void) | undefined;
  /** Question-scoped re-ask classification of the current pending window
   * (see the former Computed._x?._reask doc): set by recompute from
   * REACTIVE_REASK, cleared on landing; meaningless while not pending. */
  _reask: boolean;
  _child: FirewallSignal<any> | null;
  _unobserved: (() => void) | undefined;
  _snapshotValue: any;
}

export interface RawSignal<T> {
  _subs: Link | null;
  _subsTail: Link | null;
  /**
   * DEV-only live subscriber count. Maintained by `link`/`unlinkSubs` for
   * graph-size diagnostics; undefined in production.
   */
  _subCount?: number;
  _value: T;
  _name?: string;
  _equals: false | ((a: T, b: T) => boolean);
  _config: number;
  _time: number;
  _pendingValue: T | typeof NOT_PENDING;
  /** Cold extension — see NodeExtension. */
  _x: NodeExtension | null;
}

export interface FirewallSignal<T> extends RawSignal<T> {
  _firewall: Computed<any>;
  _nextChild: FirewallSignal<unknown> | null;
}

export type Signal<T> = RawSignal<T> | FirewallSignal<T>;
export interface Owner {
  id?: string;
  _config: number;
  _snapshotScope?: boolean;
  /** Effect-returned cleanup; managed across reruns, invoked at true disposal */
  _cleanup?: () => void;
  _disposal: Disposable | Disposable[] | null;
  _parent: Owner | null;
  _context: Record<symbol | string, unknown>;
  _childCount: number;
  _queue: IQueue;
  _firstChild: Owner | null;
  _nextSibling: Owner | null;
  _prevSibling: Owner | null;
  _pendingDisposal: Disposable | Disposable[] | null;
  _pendingFirstChild: Owner | null;
}

export interface Computed<T> extends RawSignal<T>, Owner {
  _deps: Link | null;
  _depsTail: Link | null;
  /**
   * DEV-only live source count. Maintained by `link`/`unlinkSubs` for
   * graph-size diagnostics; undefined in production.
   */
  _depCount?: number;
  /** Recompute-pass counter; bumped when dep revalidation starts. */
  _depGen: number;
  _flags: number;
  _statusFlags: number;
  _height: number;
  _nextHeap: Computed<any> | undefined;
  _prevHeap: Computed<any>;
  _fn: (prev?: T) => T;
  /**
   * Clock tick at which REACTIVE_MANUAL_WRITE was last applied
   * (`suppressComputedRecompute`). Lets `refresh()` distinguish a same-tick
   * manual write (which wins over the refresh, #2692) from a mask carried
   * across ticks by a transaction (which an explicit refresh lifts, #3026).
   * Only meaningful while REACTIVE_MANUAL_WRITE is set.
   */
  _manualWriteTime?: number;
  /**
   * True while a `loadingValue` node's first real answer hasn't landed: the
   * node was born committed (commit #0 = the loading value) and `handleAsync`
   * serves that committed value instead of throwing NotReadyError, so first
   * flights never suspend readers, trip boundaries, or hold transitions.
   * The window is verdict-quiet: `isPending` stays false, because commit #0
   * answers the question by declaration (first-load affordances belong to
   * the value channel). Cleared by the first value landing on any path (sync
   * return, sync-resolved promise, first iterator yield, async settle); a
   * real error leaves it set — errors answer reads but don't enter the value
   * lineage, so a retry serves the loading value again. Once cleared, normal
   * pending/refetch semantics apply forever. (Stays in CORE: written
   * unconditionally by recompute and every commit.)
   */
  _loading: boolean;
}

export interface Root extends Owner {
  _root: true;
  _parentComputed: Computed<any> | null;
  dispose(self?: boolean): void;
}
