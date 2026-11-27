import type { NOT_PENDING } from "./constants.js";
import type { Transaction } from "./scheduler.js";

export interface Disposable {
  (): void;
}
export interface Link {
  _dep: Signal<unknown> | Computed<unknown>;
  _sub: Computed<unknown>;
  _nextDep: Link | null;
  _prevSub: Link | null;
  _nextSub: Link | null;
  /** The subscriber's `_depGen` when this link was last validated: equal means
   * it is inside the `[deps.._depsTail]` prefix, an O(1) membership test. */
  _gen: number;
}

export interface NodeOptions<T> {
  id?: string;
  name?: string;
  /**
   * Source location (`file:line:col`, root-relative) written by the
   * compiler's `sourceNames` `locations` kind; dev and observe builds keep it
   * for console reports and diagnostic events, production ignores it. Not
   * meant to be written by hand.
   */
  loc?: string;
  transparent?: boolean;
  equals?: ((prev: T, next: T) => boolean) | false;
  ownedWrite?: boolean;
  /** Exclude this signal from snapshot capture (internal — not part of public API) */
  _noSnapshot?: boolean;
  /** Extra CONFIG_* bits OR'd in at creation (internal), so per-flag option arms
   * stay out of the creation path. */
  _extraConfig?: number;
  /** Observe tiers: framework plumbing; no name, owner-path segment or records
   * of its own (internal; CONFIG_PLUMBING). */
  _plumbing?: boolean;
  /** Observe tiers: wide by construction; exempt from WIDE_SCOPE_DEPS, not
   * HUGE_FAN_IN (internal; CONFIG_WIDE). */
  _wide?: boolean;
  /** Observe tiers: supersedes its own flights by design; exempt from
   * ABANDONED_FLIGHTS (internal; CONFIG_SUPERSEDES). */
  _supersedes?: boolean;
  unobserved?: () => void;
  lazy?: boolean;
  sync?: boolean;
  /** Commit #0. When present (checked with `in`, so `undefined` counts), the node
   * is born committed with this value: reads serve it, nothing suspends, nothing
   * holds, and `isPending` stays false. After the first real answer, normal
   * pending and refetch apply. */
  loadingValue?: T;
}

/** Cold node extension: rarely used fields live one hop away so the core
 * literal stays under V8's in-object property limit (past ~39 fields,
 * creation cost roughly quadruples). Allocated lazily by `ext()`; one shape
 * for signals and computeds keeps `_x` monomorphic. `_config` bits stay the
 * hot-path gates: a bit says "consult _x", never the reverse. */
export interface NodeExtension {
  _inFlight: PromiseLike<any> | AsyncIterable<any> | null;
  /** Closes the current iterator flight; fired where `_inFlight` is released, so
   * a superseded stream stops at once (#3122). Null for promises. */
  _flightTeardown: (() => void) | null;
  _error: unknown;
  _blocked: boolean | undefined;
  _pendingSources: Set<Computed<any>> | undefined;
  /** Clock of the pass that served an answered-then-reasked first answer: one
   * served pass a flush (D-22, F-9). */
  _served?: number;
  _unobserved: (() => void) | undefined;
  _snapshotValue: any;
  /** The previous pass's children and disposal list, still live until this
   * node's commit disposes them. */
  _pendingFirstChild: Owner | null;
  _pendingDisposal: Disposable | Disposable[] | null;
  /** The hold holding this node while CONFIG_HELD is set; resolve with `txOf`. */
  _transaction: Transaction | null;
  /** The current flight re-asks the same question: quiet through its commit (F-9). */
  _reask: boolean;
  /** The staging the last flush left on a held node, kept across an unflushed
   * rewrite (F-10); valid while `_flushedAt` is the current clock. */
  _flushed: unknown;
  _flushedAt: number;
  /** Provenance (D-34): the question this node's guess or flight answers; 0 unstamped. */
  _q: number;
  /** The lane has shown this node: `_value` is the lane's value. Cleared
   * when the node leaves the lane. */
  _shown: boolean;
  /** A shown guess nothing has answered yet: `_pendingValue` is the value
   * it reverts to, staged at its reveal (lanes.ts `reveal`, F-11). */
  _revert?: boolean;
  /** The hold, or flush clock, under which a window read this staging
   * (`holdStaging`, D-25, #4544). Never cleared; stale once that hold ends. */
  _askedIn?: Transaction | number;
  /** The hold whose own work read this memo (D-25, #4776). */
  _readIn?: Transaction;
  /** Live `affects()` marks on this node (F-9). A count, never a hold. */
  _marks: number;
  /** The error shown when a re-ask made the node pending: still the display
   * until a new answer commits (D-41). */
  _shownError: unknown;
  /** A staged error a re-ask replaced before it showed: `latest`'s newest answer
   * while the re-ask flies (D-22, D-41). */
  _aheadError?: unknown;
  /** A verdict reader's frame flight, parked when the seam re-derived the reader
   * in the verdict lane; the landing adopts it instead of asking again (D-25,
   * F-9; verdict.ts `adoptParked`). Cleared by any later pass. */
  _parked?: PromiseLike<any>;
}

export interface RawSignal<T> {
  _subs: Link | null;
  _subsTail: Link | null;
  _value: T;
  /** Observe tier label (`name` or node kind). A literal slot, absent from prod. */
  _name?: string;
  /** Observe tier: the owner when a user-facing signal was created, for owner
   * paths. A literal slot, absent from prod. */
  _owner?: Owner | null;
  _equals: false | ((a: T, b: T) => boolean);
  _config: number;
  _time: number;
  /** Epoch of the last subscriber walk: a re-write to a staged node with the
   * current epoch skips the walk (§12d). */
  _notifiedAt: number;
  _pendingValue: T | typeof NOT_PENDING;
  /** Cold extension — see NodeExtension. */
  _x: NodeExtension | null;
}

export type Signal<T> = RawSignal<T>;
export interface Owner {
  id?: string;
  _config: number;
  /** Lifecycle flags (REACTIVE_*); roots carry only REACTIVE_DISPOSED. */
  _flags: number;
  _snapshotScope?: boolean;
  /** Effect-returned cleanup; managed across reruns, invoked at true disposal */
  _cleanup?: () => void;
  _disposal: Disposable | Disposable[] | null;
  _parent: Owner | null;
  _context: Record<symbol | string, unknown>;
  _childCount: number;
  _firstChild: Owner | null;
  _nextSibling: Owner | null;
  _prevSibling: Owner | null;
  /** Cold extension — see NodeExtension. */
  _x: NodeExtension | null;
  /** Observe tier label: `name`, node kind, or a component label from the
   * rendering layer. Absent from prod. */
  _name?: string;
  /** Observe tier source location. Reserved from mangling: solid-js writes it,
   * diagnostics read it. Absent from prod. */
  _loc?: string;
}

export interface Computed<T> extends RawSignal<T>, Owner {
  _deps: Link | null;
  _depsTail: Link | null;
  /** Recompute-pass counter; bumped when dep revalidation starts. */
  _depGen: number;
  _flags: number;
  _statusFlags: number;
  _height: number;
  _nextHeap: Computed<any> | undefined;
  _prevHeap: Computed<any>;
  _fn: (prev?: T) => T;
  /** True until a `loadingValue` node's first real answer lands: until then
   * `handleAsync` serves commit #0 instead of throwing. An error leaves it set,
   * so a retry serves the loading value again. */
  _loading: boolean;
}

export interface Root extends Owner {
  _root: true;
  _parentComputed: Computed<any> | null;
  dispose(self?: boolean): void;
}
