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
}

export interface NodeOptions<T> {
  id?: string;
  name?: string;
  transparent?: boolean;
  equals?: ((prev: T, next: T) => boolean) | false;
  pureWrite?: boolean;
  unobserved?: () => void;
  lazy?: boolean;
}

export interface RawSignal<T> {
  _subs: Link | null;
  _subsTail: Link | null;
  _value: T;
  _snapshotValue?: any;
  _name?: string;
  _equals: false | ((a: T, b: T) => boolean);
  _pureWrite?: boolean;
  _unobserved?: () => void;
  _time: number;
  _transition: Transition | null;
  _pendingValue: T | typeof NOT_PENDING;
  _optimistic?: boolean;
  _optimisticLane?: OptimisticLane; // Lane this node is associated with (for optimistic propagation)
  _pendingSignal?: Signal<boolean>; // Lazy signal for isPending()
  _latestValueComputed?: Computed<T>; // Lazy computed for latest()
  _parentSource?: Signal<any> | Computed<any>; // Back-reference for parent-child lane relationship
}

export interface FirewallSignal<T> extends RawSignal<T> {
  _firewall: Computed<any>;
  _nextChild: FirewallSignal<unknown> | null;
}

export type Signal<T> = RawSignal<T> | FirewallSignal<T>;
export interface Owner {
  id?: string;
  _transparent?: boolean;
  _snapshotScope?: boolean;
  _disposal: Disposable | Disposable[] | null;
  _parent: Owner | null;
  _context: Record<symbol | string, unknown>;
  _childCount: number;
  _queue: IQueue;
  _firstChild: Owner | null;
  _nextSibling: Owner | null;
  _pendingDisposal: Disposable | Disposable[] | null;
  _pendingFirstChild: Owner | null;
}

export interface Computed<T> extends RawSignal<T>, Owner {
  _deps: Link | null;
  _depsTail: Link | null;
  _flags: number;
  _inSnapshotScope?: boolean;
  _error?: unknown;
  _statusFlags: number;
  _height: number;
  _nextHeap: Computed<any> | undefined;
  _prevHeap: Computed<any>;
  _fn: (prev?: T) => T;
  _inFlight: PromiseLike<T> | AsyncIterable<T> | null;
  _child: FirewallSignal<any> | null;
  _notifyStatus?: (status?: number, error?: any) => void;
}

export interface Root extends Owner {
  _root: true;
  _parentComputed: Computed<any> | null;
  dispose(self?: boolean): void;
}
