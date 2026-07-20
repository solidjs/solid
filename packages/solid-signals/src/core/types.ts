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
}

export interface RawSignal<T> {
  _subs: Link | null;
  _subsTail: Link | null;
  _value: T;
  _snapshotValue?: any;
  _name?: string;
  _equals: false | ((a: T, b: T) => boolean);
  _config: number;
  _unobserved?: () => void;
  _time: number;
  _transition: Transition | null;
  _pendingValue: T | typeof NOT_PENDING;
  _overrideValue?: T | typeof NOT_PENDING;
  /**
   * The transaction that owns the active override (stamped at optimistic
   * write, cleared at settle). Ownership must live on the node: a lane's
   * _transition is a scheduling affinity that a shared subscriber can merge
   * across transactions (#2912) — following it would let one action's settle
   * revert another action's live override. Node-level sibling of the store
   * layer's STORE_OPTIMISTIC_OWNERS stamps (#2899). `null` = ambient write.
   */
  _overrideOwner?: Transition | null;
  _optimisticLane?: OptimisticLane;
  _pendingSignal?: Signal<boolean>; // Lazy signal for isPending()
  _latestValueComputed?: Computed<T>; // Lazy computed for latest()
  _parentSource?: Signal<any> | Computed<any>; // Back-reference for parent-child lane relationship
  /**
   * Live `affects()` marks on this node (refcount). Non-zero is declared
   * motion: the node — and, via the verdict layer's dep-graph coverage walk,
   * everything derived from it — reads pending regardless of graph state,
   * until every declaring transaction settles/reverts and releases its mark.
   * This count is the mark's ONLY graph state: the dedicated channel stores
   * nothing downstream and never touches status flags, errors, or pending
   * sources.
   */
  _affectsCount?: number;
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
  /** Recompute-pass counter; bumped when dep revalidation starts. */
  _depGen: number;
  _flags: number;
  _blocked?: boolean;
  _pendingSources?: Set<Computed<any>>;
  _error?: unknown;
  _statusFlags: number;
  _height: number;
  _nextHeap: Computed<any> | undefined;
  _prevHeap: Computed<any>;
  _fn: (prev?: T) => T;
  _inFlight: PromiseLike<T> | AsyncIterable<T> | null;
  _child: FirewallSignal<any> | null;
  _notifyStatus?: (status?: number, error?: any) => void;
  /**
   * Question-scoped pending classification of the node's CURRENT pending
   * window: `true` means the in-flight recompute is a re-ask of the same
   * question (refresh/poll/confirm — no tracked input changed value), so the
   * shown answer still answers the question and the node reads NOT pending.
   * Set by `recompute` from `REACTIVE_REASK`, cleared on landing
   * (`clearStatus`). Meaningless while not STATUS_PENDING.
   */
  _reask: boolean;
}

export interface Root extends Owner {
  _root: true;
  _parentComputed: Computed<any> | null;
  dispose(self?: boolean): void;
}
