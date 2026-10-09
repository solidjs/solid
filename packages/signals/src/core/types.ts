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
  /**
   * `_sub._depGen` at the time this link was created or last revalidated
   * in-order. A link stamped with the subscriber's current pass generation is
   * inside the validated `[deps.._depsTail]` prefix — an O(1) replacement for
   * scanning the dep list to answer membership (see `link()`).
   */
  _gen: number;
}

export interface NodeOptions<T> {
  id?: string;
  name?: string;
  transparent?: boolean;
  equals?: ((prev: T, next: T) => boolean) | false;
  ownedWrite?: boolean;
  /** Exclude this signal from snapshot capture (internal — not part of public API) */
  _noSnapshot?: boolean;
  /** Extra CONFIG_* bits OR'd into the node's config at creation (internal —
   * not part of public API). Used by refresh() for CONFIG_FRESH_READ,
   * keeping the per-flag option arms out of the core creation path. */
  _extraConfig?: number;
  /** Observe tiers: framework plumbing — no name, no owner-path segment, no
   * attribution records of its own; its children stay observed (internal —
   * not part of public API; see CONFIG_PLUMBING). */
  _plumbing?: boolean;
  /** Observe tiers: a framework scope wide by construction — exempt from
   * WIDE_SCOPE_DEPS, never from HUGE_FAN_IN (internal — not part of public
   * API; see CONFIG_WIDE). */
  _wide?: boolean;
  /** Observe tiers: a framework async node that supersedes its own flights by
   * design — exempt from ABANDONED_FLIGHTS (internal — not part of public
   * API; see CONFIG_SUPERSEDES). */
  _supersedes?: boolean;
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
   * the first successful or failed answer reveals, normal refetch/pending
   * semantics apply. A failure retains this successful payload for memo prev,
   * but accessor reads throw the published failure through a pending retry.
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
  _inFlight: PromiseLike<any> | AsyncIterable<any> | null;
  /** Cancellation for the CURRENT iterator flight (#3122): closes the
   * iterator (`it.return()`), idempotent. Fired at the sites that release
   * `_inFlight` so a superseded stream stops at supersede time. Null for
   * plain promise flights (no cancellation hook exists). */
  _flightTeardown: (() => void) | null;
  _error: unknown;
  /** Error of the last published outcome, retained through pending/recovery. */
  _committedError: unknown;
  /** Failure last revealed by an optimistic/derived lane. */
  _laneError: unknown;
  _blocked: boolean | undefined;
  _pendingSources: Set<Computed<any>> | undefined;
  _unobserved: (() => void) | undefined;
  _snapshotValue: any;
  /** L2 — the previous pass's frame, parked for this node's commit: its child
   * chain and `_disposal` list, still reacting until the commit disposes
   * them (or the owner's death does). */
  _pendingFirstChild: Owner | null;
  _pendingDisposal: Disposable | Disposable[] | null;
  /** L2 — the transaction holding this node while CONFIG_HELD is set
   * (`holdNode`); resolved through merges by `txOf`. */
  _transaction: Transaction | null;
  /** L2 — the transaction a first pass that went pending was born into (it
   * read a held node, or a verdict lane's mount read a staging of the
   * flush — the born-held arm's conditions): its first answer lands into it
   * while it is live; the hold never waits for the node's first load (the
   * direction rule, #3800). Consumed at the landing. */
  _bornIn: Transaction | null;
  /** The node's current flight re-asks the same question (a `refresh()`,
   * A19 exc. 2 / A24): verdict-quiet — `isPending` reads false for it —
   * through its landing until the commit. */
  _reask: boolean;
  /** A28: the staging the last flush left on a held node, kept across an
   * unflushed rewrite — what `latest()` and a tracked reader see until the
   * flush that carries the rewrite; valid while `_flushedAt` is the current
   * clock (that flush advances it). */
  _flushed: unknown;
  _flushedAt: number;
  /** Provenance (A18, #3331): the question this node's guess or latest
   * flight answers (`scheduler.question`); 0 when unstamped. */
  _q: number;
  /** Lanes (plan sec. 28) — the lane's value for this node while CONFIG_OVERRIDE is
   * set: a written guess, or a lane pass's derivation. `NOT_PENDING` when
   * none. The screen shows it once the lane has revealed (`_shown`); a
   * direct read sees it throughout; the committed truth stays `_value`. */
  _lane: unknown;
  /** `affects()` marks live on this node (affects.ts): declared in-flight
   * changes — `isPending` reads true for it and its derivations while any
   * is live. A count, never a hold. */
  _marks: number;
}

export interface RawSignal<T> {
  _subs: Link | null;
  _subsTail: Link | null;
  _value: T;
  /**
   * Observe-tier label (`name` option, or the node kind: `signal`,
   * `computed`, `effect`…). A slot in the observe/dev literals — never a
   * post-construction write — and absent from the prod literals entirely.
   */
  _name?: string;
  /**
   * Observe-tier: the owner in scope when a user-facing signal was created
   * (`registerGraph`), so diagnostics about the signal get an owner path.
   * A slot in the observe/dev `signal()` literal; absent from prod.
   */
  _owner?: Owner | null;
  _equals: false | ((a: T, b: T) => boolean);
  _config: number;
  _time: number;
  /** Notify-epoch stamp of the last subscriber walk (§12d). A re-write to an
   * already-staged node whose stamp still equals the global epoch skips the
   * whole walk — marking is idempotent, and the epoch bumps on every
   * recompute and new subscriber edge (either can invalidate the skip). */
  _notifiedAt: number;
  _pendingValue: T | typeof NOT_PENDING;
  /** Cold extension — see NodeExtension. */
  _x: NodeExtension | null;
}

export type Signal<T> = RawSignal<T>;
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
  _firstChild: Owner | null;
  _nextSibling: Owner | null;
  _prevSibling: Owner | null;
  /** Cold extension — see NodeExtension. */
  _x: NodeExtension | null;
  /**
   * Observe-tier label: the `name` option, the node kind (`computed`,
   * `effect`…), or the component label the rendering layer writes on a root
   * (`<App>`). A slot in the observe/dev literals; absent from prod.
   */
  _name?: string;
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
  /**
   * True while a `loadingValue` node's first real answer hasn't landed: the
   * node was born committed (commit #0 = the loading value) and `handleAsync`
   * serves that committed value instead of throwing NotReadyError, so first
   * flights never suspend readers or trip boundaries. Cleared by the first value landing on any path (sync
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
