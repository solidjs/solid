import {
  CONFIG_HELD,
  CONFIG_COMMITTED_ERROR,
  CONFIG_IN_SNAPSHOT_SCOPE,
  CONFIG_GUESS,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_OVERRIDE,
  CONFIG_REDERIVE,
  CONFIG_STAGED,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  CONFIG_HAS_SNAPSHOT,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_FRAME_READ,
  REACTIVE_LANE_DIRTY,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_MISSED_WAKE,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { attrHooks } from "./attribution-hooks.js";
import { ext, markUnflushedStaged, recompute, resyncUnflushedCompanions } from "./core.js";
import { DEV, emitDiagnostic, GRAPH_SIZE_WARN_AT, noteFanOut, reportDiagnostic } from "./dev.js";
import { sweepDormant, trimStaleDeps } from "./graph.js";
import { deleteFromHeap, enqueueSub, runHeap, type Heap } from "./heap.js";
import { devCheckQuiescent } from "./invariants.js";
import type { Computed, Owner, Signal } from "./types.js";

// CARVE 3: transactions (Transition objects, the ambient batch, holds/parks,
// stashed effect queues, async reporters, actions, zombies, entanglement,
// origin/provenance) were removed on the measurement branch. Same-flush
// staging stays: writes land in `_pendingValue`, are queued here, and commit
// at the end of the flush that carried them.
//
// L2 (step 2): one seam on top of that — at the end of a flush's pure phase
// the flush either COMMITS its staged nodes or PARKS them. It parks when a
// pass joined a transaction: something went pending, or a pass touched a
// node already held (a write to it, a tracked read of it, a re-pass over
// it). Parked nodes are held by the transaction (flagged CONFIG_HELD,
// `_x._transaction`) and the flush's effect queues are stashed with them. The
// park decision is the pass's own (`joinFuture`), never a verdict computed
// after the fact.
//
// Step 3 — transactions are independent (A15: "writes on fully disjoint
// graphs keep independent transitions and settle independently";
// maintainer, 2026-10-01: "we only hold changes that trigger within the same
// synchronous frame as the async, or that come in later and would overlap
// along dependencies… if there isn't this overlap the change happens as its
// own transaction"). A flush that goes pending with nothing held opens a
// transaction; one that touches a held node joins the node's; one that
// touches two merges them (overlap along dependencies). Each lands — its
// held nodes commit, its stashed effects run — at the first seam where no
// frame derives from a flight it holds (`blocked`). A flight's landing
// resumes the frame that started it ("it resumes the sync frame"): the
// settle walk joins the held reader's transaction (async.ts).
//
// Rule 3 / A15's stale reader: render effects are the frame, not
// derivations. They are the only nodes that report participation
// (`notify`), and reading a held node does not make them part of its
// transaction: outside that transaction's own flush they see the committed
// value (`frameRead`, core.ts), publish mainline, and are re-derived after
// its landing (`_reruns`). A write that reaches a transaction only through
// a render effect is its own transaction (#3322, #3407, #3412).

export interface Transaction {
  /** Held staged nodes: committed at the landing. For a lane: its guesses
   * and its work (their lane values in `_x._lane`), revealed at the seam. */
  _nodes: Signal<any>[];
  /** Stashed effect queues (render, user): run ahead of the landing flush's. */
  _queues: [QueueCallback[], QueueCallback[]];
  /** Render effects that read a held node as committed (A15's stale
   * readers): re-derived after the landing. One entry per pass. */
  _reruns: Computed<any>[];
  /** Merged into another (overlap): resolve through it (`txOf`). */
  _into: Transaction | null;
  /** Lane: the transition it is a sub-frame of — it reads that world through
   * and ends with it. */
  _parent: Transaction | null;
  /** A lane. Cleared when a blocked lane outlives its parent and continues
   * as a transaction. */
  _lane: boolean;
  /** The lane the readers of this transaction's verdicts (`isPending`,
   * `latest`) break out into — a guess the system supplies: "pending, until
   * this lands", "the proposal is the value". Opened at the first such read,
   * ends with the transaction. */
  _verdict: Transaction | null;
  /** Actions (action.ts) still running in it: held open — blocked — until
   * every one has returned. Summed when transactions merge. */
  _open: number;
  /** An action ran in it (action.ts). Its body ending (`_open` back to 0)
   * supersedes the guesses still in force whose own truth is not in flight
   * (A18 body-end corollary, #3427; lanes.ts). */
  _acted: boolean;
  /** Lane: the lanes a frame derives from together with this one (a pass
   * read two lanes' work — #3335): one reveal unit, each blocked while any
   * is; shared array. Lifetimes stay their own (#2912). */
  _links: Transaction[] | null;
  /** Lane: it has revealed — its values are the screen (`display`,
   * lanes.ts) and its passes stage for the next reveal. Set at the first
   * seam it is not blocked; a verdict lane is born shown. */
  _shown: boolean;
  /** Lane: the last seam found it blocked (its own flight up). A frame
   * leaf reading a held lane that has not shown is a stale reader of it
   * (#3460); one reading a lane the seam has not judged yet is its work. */
  _held: boolean;
  /** `affects()` marks declared in it (affects.ts): released at the landing.
   * Not nodes — a mark holds nothing (`blocked` never sees one). */
  _marks: Signal<any>[] | null;
}
/** Live transactions — opened, unmerged, not landed. Scanned at every seam
 * while non-empty; nothing on the plain path. */
const transactions: Transaction[] = [];
/** Observe tier: this flush parked its transaction (`holdStart` fired). */
let holding = false;
/** A transaction (listed here) or a lane (lanes.ts lists its own). */
export function newTransaction(lane: boolean, parent: Transaction | null = null): Transaction {
  const t: Transaction = {
    _nodes: [],
    _queues: [[], []],
    _reruns: [],
    _into: null,
    _parent: parent,
    _lane: lane,
    _verdict: null,
    _open: 0,
    _acted: false,
    _links: null,
    _shown: false,
    _held: false,
    _marks: null
  };
  if (!lane) transactions.push(t);
  return t;
}

// Lanes (plan sec. 28, 2026-10-02; lanes.ts). A lane is "a new base of a transition":
// the sub-frame an optimistic write opens in the transition of the frame it
// is made in. It sees the screen plus its own guesses (plan sec. 19), breaks out of
// the parent's hold — its effects run now — and holds itself if its own
// derivations hit async. It ends when the parent lands: a guess reverts to
// the truth it covered, or lands as the truth that superseded it. A frame
// that does not park has nothing to be optimistic over: the write is void.
//
// The seat of a pass is its node's: a node carrying a lane's value runs as
// the lane's whoever dirtied it; a derivation's tracked read of a lane's
// value moves its pass into the lane; a leaf's never does (it reads the
// screen). Lane work's values go to the lane slot, its runs to the lane's
// queues; the rest of the frame is the flush's.

/** The lane the running pass is work of; set at `recompute`'s head from the
 * node, moved by a derivation's lane read, saved and restored around the
 * pass. */
export let passLane: Transaction | null = null;
export function setPassLane(l: Transaction | null): void {
  passLane = l;
}
/** The transaction this flush parks into: set by the first join, merged
 * with every further one. Consumed at the seam. A join outside a flush (a
 * mount's pending observer, a write to a held node, an action opening)
 * schedules the seam that consumes it: membership is the tick's — the same
 * synchronous frame — and the next tick's writes are not this one's. */
export let flushTransaction: Transaction | null = null;
/** The transaction the passes running OUTSIDE a flush this tick derive from
 * (a mainline mount, a mainline re-pass): the passes' own (A29, creation-
 * time form — "the entry is the pass's alone"): their results are staged
 * into it, and nothing else in the tick is — a write made after the mount
 * is a mainline write, a render effect mounted beside it a stale reader.
 * Inside a flush, or in a tick that already has its transaction (an
 * action's body), the frame joins instead (`flushTransaction`) — except a
 * first pass a loading boundary that has not shown content catches (`own`,
 * A29's boundary exemption, #3540): it is the boundary's, not the tick's,
 * and a flush that has joined nothing keeps it pass-scoped as outside one.
 * Cleared by the flush the join schedules, and at the end of a flush that
 * set it. */
export let passTx: Transaction | null = null;
export function joinPassTx(t: Transaction, own?: unknown): void {
  if ((globalQueue._running && !own) || flushTransaction !== null) return joinFuture(t);
  if (passTx === null) passTx = resolveTx(t);
  else merge(resolveTx(t), passTx);
  schedule();
}
/** The transaction holding a node (CONFIG_HELD set), resolved through
 * merges; the path is compressed. */
export function txOf(n: Signal<any> | Computed<any>): Transaction {
  return (n._x!._transaction = resolveTx(n._x!._transaction!));
}
/** `t` resolved through merges while it is still parked or open; null once
 * it has landed. */
export function liveTx(t: Transaction): Transaction | null {
  t = resolveTx(t);
  return transactions.indexOf(t) !== -1 ? t : null;
}
export function resolveTx(t: Transaction): Transaction {
  while (t._into !== null) t = t._into;
  return t;
}
/** The flush joins transaction `t` — or needs one of its own (`null`: a pass
 * went pending with nothing held). Joining a second one merges it into the
 * flush's: the work that touched both entangles them (A15). */
export function joinFuture(t: Transaction | null): void {
  const f = flushTransaction;
  if (f === null) {
    flushTransaction = t === null ? newTransaction(false) : resolveTx(t);
  } else if (t !== null) merge(resolveTx(t), f);
  if (!globalQueue._running) schedule();
}
/** `t` merges into `f`: the work that touched both entangles them (A15).
 * A lane never merges: it is a sub-frame, not a peer — its work is routed
 * per pass (`passLane`). */
export function merge(t: Transaction, f: Transaction): void {
  // Both ends resolved: a stale pointer to a transaction already merged
  // into the other would close a cycle `resolveTx` never leaves.
  t = resolveTx(t);
  f = resolveTx(f);
  if (t === f || t._lane || f._lane) return;
  if (__OBSERVE__ && attrHooks !== null) attrHooks.transitionMerged(f, t);
  t._into = f;
  f._open += t._open;
  f._acted ||= t._acted;
  append(f._nodes, t._nodes);
  append(f._queues[0], t._queues[0]);
  append(f._queues[1], t._queues[1]);
  append(f._reruns, t._reruns);
  if (t._marks !== null) append((f._marks ??= []), t._marks);
  transactions.splice(transactions.indexOf(t), 1);
}
/** A15: a hold is a property of the async node — observed pending by a
 * render reader. A transaction is blocked while a node it holds, in flight,
 * has one: a pending render effect (the frame itself), or a pending held
 * node a render effect reads. A stale reader served the committed value
 * never went pending, but derives from the flight all the same (#3494) and
 * is still linked to it; a memo between them is pending, and held, too — so
 * one hop of `_subs` is the chain. Reads of the reader's LAST pass only (the
 * link's generation is the pass's): a tail kept for A30 — the committed
 * frame's dependency, awaiting the run that retires it — is not a read of
 * the flight, and a reader that stopped reading releases it (O3, #3494).
 * An errored pass (NotReady included) did not stop: it never got there, and
 * its full list stands (A30) — the reads it did not reach still observe. A
 * flight nobody renders holds nothing (A29). Only the nodes `t` still owns
 * count: one a lane took over since is the lane's to wait on. A guess whose
 * own truth is in flight blocks the lane's parent, not the lane — it stands
 * in for the flight (A17: "visible until its own fetch settles"). */
export function blocked(t: Transaction): boolean {
  // The transaction being judged (a lane consulted on its behalf judges for
  // it): a zombie whose removal it stages is moot for it alone (`onScreen`).
  const prev = judge;
  judge ??= t;
  // An action still running in it holds it open (action.ts). Its lanes
  // (lanes.ts): a lane under `t` blocks it while blocked itself.
  const r =
    t._open !== 0 ||
    blockedBy(t._nodes, t) ||
    (!!GlobalQueue._lanesBlocked && GlobalQueue._lanesBlocked(t));
  judge = prev;
  return r;
}
let judge: Transaction | null = null;
/** Observe tier: the flights `t` waits on — its pending held sources a
 * frame reader observes (`blockedBy`'s predicate, collected; the readers
 * themselves are not sources). */
export function blockersOf(t: Transaction): Computed<any>[] {
  const out: Computed<any>[] = [];
  for (let i = 0; i < t._nodes.length; i++) {
    const n = t._nodes[i] as Computed<any>;
    if (
      !(n as any)._type &&
      n._statusFlags & STATUS_PENDING &&
      !(n._flags & REACTIVE_DISPOSED) &&
      (n._x!._transaction === null || txOf(n) === t) &&
      blockedBy([n], t)
    )
      out.push(n);
  }
  return out;
}
/** `t`'s own flights only — not its lanes': a flight the frame asked for
 * (a refetch, a plain load) is authoritative; a lane's derivation flight is
 * not (lanes.ts, the body-end corollary). A pending reader counts only if
 * one of the sources it waits on is `t`'s (a render effect marked pending
 * by a lane flight, never re-run, is the lane's wait, not the frame's). */
export function ownFlights(t: Transaction): boolean {
  return blockedBy(t._nodes, t, true);
}
/** A source the pending node waits on that is `t`'s (held by it, or by no
 * one) — not another transaction's or lane's work. Itself, when it is the
 * source. */
function ownSource(n: Computed<any>, t: Transaction): boolean {
  const sources = n._x?._pendingSources;
  if (sources === undefined) return true;
  for (const s of sources) {
    const u = s._x?._transaction;
    if (u == null || resolveTx(u) === t) return true;
  }
  return false;
}
function blockedBy(nodes: Signal<any>[], owner: Transaction, own = false): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as Computed<any>;
    if (
      !(n._statusFlags & STATUS_PENDING) ||
      n._flags & REACTIVE_DISPOSED ||
      n._config & CONFIG_GUESS ||
      (n._x!._transaction !== null && txOf(n) !== owner) ||
      (own && !ownSource(n, owner))
    )
      continue;
    // The frame's own pending observer (off screen: this one holds nothing;
    // the next listed node may).
    if ((n as any)._type === EFFECT_RENDER) {
      if (onScreen(n, judge ?? owner)) return true;
      continue;
    }
    for (let s = n._subs; s !== null; s = s._nextSub) {
      const r = s._sub;
      // A frame reader: a render effect, or a stale reader of the flight
      // (REACTIVE_FRAME_READ — a verdict reader, `observeFlight`; lane work,
      // `frameRead`): served committed instead of going pending, it derives
      // from the flight all the same and is re-derived at the landing — the
      // frame's observation survives its reader becoming a lane's (a guess
      // over a held window, V5/A17). A probe alone does not hold. A
      // boundary showing content forwards the pending (its output pending,
      // CONFIG_REDERIVE): transparent, its readers hold through it (A33; the
      // lane-membership ruling, 2026-10-05). An output that never committed
      // shows nothing — a mount the frame has not revealed — and holds
      // nothing.
      if (
        ((r as any)._type === EFFECT_RENDER ||
          r._flags & REACTIVE_FRAME_READ ||
          (r._config & CONFIG_REDERIVE && r._statusFlags === STATUS_PENDING)) &&
        (s._gen === r._depGen || r._x?._error != null) &&
        !(r._flags & REACTIVE_DISPOSED) &&
        onScreen(r, judge ?? owner)
      )
        return true;
    }
  }
  return false;
}
/** A frame reader whose say counts for `t`'s hold — `t` the transaction
 * being judged: not a zombie whose removal `t` stages (A15 #3463: a re-ask
 * in the unmount frame lands its pending on the zombie it unmounts — the
 * compiled <Show> of #3372; a zombie blocks every other judgment while it
 * is visible, a lane's reveal included: only the commit that disposes it
 * makes its say moot), and not behind a fallback (A33: a boundary showing its fallback is the display of
 * everything under it, so a reader there is not on screen and holds
 * nothing — boundaries.ts). */
function onScreen(r: Computed<any>, t: Transaction): boolean {
  return (
    !(r._flags & REACTIVE_ZOMBIE && removalStagedBy(r, t)) &&
    !(GlobalQueue._hidden && GlobalQueue._hidden(r))
  );
}
/** A15 (#3463): a reader whose removal is staged — a zombie, parked by a
 * pass awaiting its commit — is still on screen and live for every hold,
 * except the transaction staging its removal: for that one its say is moot
 * (done, and the commit disposes it; not done, and it stays parked). The
 * staging transaction is the one holding the pass that parked the frame:
 * the nearest non-zombie ancestor. */
function removalStagedBy(r: Computed<any>, t: Transaction): boolean {
  let o: Owner | null = r;
  while (o !== null && (o as any)._flags & REACTIVE_ZOMBIE) o = o._parent;
  return (
    o !== null &&
    (o._config & CONFIG_HELD) !== 0 &&
    (o as any)._x?._transaction != null &&
    txOf(o as any) === resolveTx(t)
  );
}
/** Unchanged passes this flush whose stale dependency tail awaits the
 * flush's verdict (A30, #3469): trimmed when the flush commits, kept when
 * it parks — the committed frame still derives from the previous pass's
 * dependencies, and a write to one of them must reach the node until a
 * committing pass replaces it. */
const heldTrims: Computed<any>[] = [];
export function heldTrim(el: Computed<any>): void {
  heldTrims.push(el);
}
/** Zombies popped from the dirty heap this flush (`deferZombie`). The seam
 * decides their fate: a park cancels them (the writes that dirtied them are
 * held with it); a commit runs the survivors — the ones whose owner is still
 * awaiting its commit — in height order, after the commits that would have
 * disposed them (#3546). No second heap: the list is the deferral. */
const deferredZombies: Computed<any>[] = [];
export function deferZombie(el: Computed<any>): void {
  deleteFromHeap(el, dirtyQueue);
  el._flags &= ~(REACTIVE_DIRTY | REACTIVE_CHECK);
  deferredZombies.push(el);
}

/** Put a staged node in a transaction: flagged, stamped, on its landing
 * list. */
export function holdNode(n: Signal<any>, t: Transaction): void {
  n._config |= CONFIG_HELD;
  list(n, t);
}

/** Put a node on a transaction's list, once: a node's `_transaction` is the
 * transaction whose `_nodes` it is on (every site that sets one does the
 * other), so a re-pass, a re-landing or a re-staging adds nothing. */
export function list(n: Signal<any>, t: Transaction): void {
  const x = ext(n);
  if (x._transaction === t) return;
  x._transaction = t;
  t._nodes.push(n);
}

/** Hold the (uncommitted) frame under a held pass: every computed in the
 * live child chain, recursively. Plain owners are walked through, not held
 * — nothing reads or re-passes them. Once per park, over the parked frames
 * only; recomputes pay nothing for it. A lane's node in the frame (listed on
 * a lane: a verdict reader broken out of this very hold — display-ahead — or
 * a derivation of a guess, CONFIG_OVERRIDE; a lane pass's effect) is the
 * lane's, as the seam's own loop has it: "lane work never makes its node
 * transaction work" (A15, #3698). Re-listed here it would carry the lane's
 * value on the transaction's list, where the landing nulls its transaction
 * and `dissolveLane` no longer finds it — a lane node with no lane, which the
 * next read of it trips over (`laneRead` → `txOf`). Its frame is the lane's
 * too (ruling A: a lane pass's children are the lane's), revealed and
 * retired at the lane's seam. */
function holdFrame(owner: Owner, t: Transaction): void {
  for (let c = owner._firstChild; c !== null; c = c._nextSibling) {
    if ((c as Computed<any>)._x?._transaction?._lane) continue;
    if ((c as Computed<any>)._fn !== undefined && !(c._config & CONFIG_HELD))
      holdNode(c as unknown as Signal<any>, t);
    holdFrame(c, t);
  }
}

export const dirtyQueue: Heap = {
  _heap: new Array(2000).fill(undefined),
  _marked: false,
  _min: 0,
  _max: 0
};

export let clock = 0;
let scheduled = false;
let halted = false;
let haltNotified = false;
let syncDepth = 0;
let inTrackedQueueCallback = false;

let _enforceLoadingBoundary = false;
export let _hitUnhandledAsync = false;
// Once per enforcement window: the ASYNC_OUTSIDE_LOADING_BOUNDARY finding is a
// fact about the MOUNT ("the root mount will be deferred"), not about each
// pending render effect — N async siblings at mount used to produce N copies.
let _reportedUnhandledAsync = false;

/**
 * Consume the unhandled-async hit. Returns whether this is the first report
 * of the current enforcement window — the caller warns only then.
 */
export function resetUnhandledAsync(): boolean {
  _hitUnhandledAsync = false;
  if (_reportedUnhandledAsync) return false;
  _reportedUnhandledAsync = true;
  return true;
}
/**
 * Toggles the dev-mode "must be inside a `<Loading>` boundary" enforcement
 * window. Only `render()` calls this — wrapping the initial mount so that a
 * top-level uncaught async read surfaces the diagnostic. Not part of the
 * user-facing API.
 *
 * @internal
 */
export function enforceLoadingBoundary(enabled: boolean): void {
  _enforceLoadingBoundary = enabled;
  if (enabled) _reportedUnhandledAsync = false;
}

export function setTrackedQueueCallback(value: boolean) {
  if (__DEV__) inTrackedQueueCallback = value;
}

// Dev-only marker for the effect half of createEffect/createRenderEffect, so
// flush() can report the no-op instead of failing silently (React parity).
/** Action bodies on the stack (action.ts): `flush()` is refused inside one —
 * the body's writes are its transaction's and commit when it settles; a
 * drain mid-step cannot reveal them, and dev says so. */
export let actionDepth = 0;
export function enterAction(): void {
  actionDepth++;
}
export function exitAction(): void {
  actionDepth--;
}

/** Provenance (A18, #3331): the question being asked — an action's
 * sequence while a slice of its body and the flush that carries it run, 0
 * otherwise. A guess is stamped with it (lanes.ts; a mainline guess takes a
 * fresh sequence: the newest intent), a flight with the question that
 * started it (async.ts; mainline is always the current question). An
 * answer from an older question than the guess it lands on is stale: held
 * silently, it does not move the graph. */
export let question = 0;
let questions = 0;
export function setQuestion(q: number): void {
  question = q;
}
export function nextQuestion(): number {
  return ++questions;
}
export const MAINLINE_QUESTION = 0x7fffffff;

export let inEffectCallback = false;

export function setEffectCallback(value: boolean) {
  if (__DEV__) inEffectCallback = value;
}

export type QueueCallback = (type: number) => void;

export function schedule() {
  if (halted) {
    notifyHalted();
    return;
  }
  if (scheduled) return;
  scheduled = true;
  if (!syncDepth && !globalQueue._running) {
    queueMicrotask(flush);
  }
}

/**
 * Permanently halts the reactive system. Called when a user error escapes
 * every boundary — app state is undefined at that point, so scheduling stops
 * entirely rather than limping along with a half-applied update.
 */
/**
 * The key a root owner carries its client error hook under (`render`'s
 * `onError`) — registered, so a runtime writes it with no import of the hook
 * module (core/error-hooks.ts) and no property mangling in the way. Defined
 * HERE, not there: a runtime that only writes the key must not retain the
 * hook machinery (pay-for-use).
 */
export const ROOT_ERROR_HOOK: unique symbol = Symbol.for("solid-js/root-error-hook") as any;

export function haltReactivity(cause?: unknown): void {
  if (halted) return;
  halted = true;
  let message = "[REACTIVITY_HALTED]";
  if (__DEV__) {
    message +=
      " An uncaught error halted the reactive system. No further updates will be processed. Handle errors with <Errored> or treat this as a crash.";
    emitDiagnostic({
      code: "REACTIVITY_HALTED",
      kind: "error",
      severity: "error",
      message
    });
  }
  // Surface the cause here too: callers rethrow it, but a creation-time throw
  // unwinds through ancestor recomputes that convert it to status instead of
  // surfacing it (#2884), so the rethrow alone cannot guarantee visibility.
  // Where the platform has one, hand the cause to its uncaught-error channel
  // (`reportError` → `error` event → window.onerror / error monitoring): a
  // halt that only reaches console.error leaves a page that LOOKS alive with
  // nothing an app or its telemetry can act on (#3338 — an uncaught throw
  // during the hydration render). The rethrow may reach the top as well in
  // the non-swallowed cases; a duplicate report beats a silent one.
  const report = cause !== undefined && globalThis.reportError;
  report || cause === undefined ? console.error(message) : console.error(message, cause);
  report && report(cause);
}

// Logs on the first write after a halt so a frozen interaction is traceable.
function notifyHalted(): void {
  if (haltNotified) return;
  haltNotified = true;
  console.error(
    __DEV__
      ? "[REACTIVITY_HALTED] Update ignored: the reactive system was halted by an earlier uncaught error."
      : "[REACTIVITY_HALTED]"
  );
}

/** @internal Test/dev-reload hook. Revives scheduling after a halt. */
export function resetErrorHalt(): void {
  halted = false;
  haltNotified = false;
}

// CARVE 4: the queue tree (boundary CollectionQueues as children of the
// global queue, status notifications forwarded up the chain, the commit's
// boundary sweep, `on` re-arms) went with the boundaries. One queue remains,
// so owners no longer carry a `_queue` pointer: effects enqueue and notify
// `globalQueue` directly. `IQueue` stays as the (public) type.
export interface IQueue {
  enqueue(type: number, fn: QueueCallback): void;
  run(type: number): boolean | void;
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean;
}

export class GlobalQueue implements IQueue {
  _queues: [QueueCallback[], QueueCallback[]] = [[], []];
  _running: boolean = false;
  declare static _update: (el: Computed<unknown>) => void;
  declare static _dispose: (el: Computed<unknown>, self: boolean, zombie?: boolean) => void;
  declare static _runEffect: (el: Computed<unknown>) => void;
  // External-source bridge (wired by enableExternalSource(); null while no
  // config is active — including after _resetExternalSourceConfig()).
  declare static _wireExternalSource: ((self: Computed<any>) => void) | undefined;
  declare static _externalUntrack: (<T>(fn: () => T) => T) | undefined;
  // Lanes (lanes.ts; installed when `createOptimistic` — or verdict.ts — is
  // imported; null otherwise, and every call site is behind a bit or a
  // `passLane` that nothing else sets).
  declare static _laneRead:
    ((c: Computed<any> | null, el: Signal<any> | Computed<any>) => unknown) | undefined;
  declare static _laneStage:
    | ((
        el: Computed<any>,
        l: Transaction,
        create: boolean,
        errored: boolean | Computed<any>
      ) => boolean)
    | undefined;
  declare static _laneOutcome:
    ((el: Computed<any>, value: unknown, errored: boolean) => boolean) | undefined;
  declare static _laneWrite: (<T>(el: Signal<T> | Computed<T>, v: T) => T) | undefined;
  declare static _applyGuesses: ((parent: Transaction | null) => void) | undefined;
  /** A slot node's truth is in flight (its family's derive — store/store.ts). */
  declare static _slotFlight: ((n: Signal<any>) => boolean) | undefined;
  /** The value a slot node's guess covered: its committed value — a chained
   * link's refreshed from the inner store, whose commits it never learned
   * while the guess served the reads (store/store.ts, §7b). */
  declare static _slotCovered: ((n: Signal<any>) => unknown) | undefined;
  /** `affects()` on a store (store/affects.ts): a store's node for a key
   * (store/store.ts `getNode`); a bare registration (birth inheritance); a
   * witnessed mark on an untracked probe (verdict.ts). */
  declare static _storeNode: ((t: any, key: PropertyKey) => Signal<any>) | undefined;
  declare static _storeWrappable: ((v: unknown) => boolean) | undefined;
  declare static _mark: ((node: Signal<any> | Computed<any>) => void) | undefined;
  declare static _witnessMark: (() => void) | undefined;
  /** An older question's truth was held beneath a guess (lanes.ts
   * `laneWrite`): the store re-bases an arrangement guess over it
   * (store/optimistic.ts). */
  declare static _laneRebase: ((el: Signal<any>, truth: unknown) => void) | undefined;
  declare static _laneSeams: ((leaks: Computed<any>[] | null) => void) | undefined;
  declare static _laneCorrections: (() => boolean) | undefined;
  declare static _endLanes: ((u: Transaction) => void) | undefined;
  declare static _lanesBlocked: ((t: Transaction) => boolean) | undefined;
  declare static _verdictLane: ((t: Transaction) => Transaction) | undefined;
  // Verdicts (verdict.ts).
  declare static _observeFlight: ((c: Computed<any>, el: Computed<any>) => boolean) | undefined;
  // Observe tier (attribution.ts): the guesses of `t`'s lanes (lanes.ts).
  declare static _laneGuesses: ((t: Transaction) => Signal<any>[]) | undefined;
  /** Store (store/store.ts): fold the pending backings whose container
   * nodes this flush committed — the owned-raw model's one mutation point. */
  declare static _storeCommit: (() => void) | undefined;
  /** The flush parked into `t`: the store materializes and holds the
   * container node of every staging that had none (store/store.ts — a
   * staging needs the node as its home only when something can read the
   * frame through it; a hold can). */
  declare static _storePark: ((t: Transaction) => void) | undefined;
  // `affects()` marks (affects.ts): the probe's coverage test, the releases
  // at a landing and at the seam (ambient marks).
  declare static _marked: ((el: Signal<any> | Computed<any>) => boolean) | undefined;
  declare static _releaseMarks: ((nodes: Signal<any>[]) => void) | undefined;
  declare static _releaseAmbientMarks: ((parked: Transaction | null) => void) | undefined;
  // Boundaries (boundaries.ts): the display consumers between an observer
  // and the root. `_catch` — status from a frame reader, nearest boundary
  // first (true: caught, the root never hears of it; a clear — flags 0 —
  // settles the reader there); `_fresh` — a pass that read a hold (true: a
  // first pass a loading boundary that has not shown content caught,
  // `joinPass`); `_hidden` — a frame reader behind a fallback is not on
  // screen and holds nothing; `_boundarySeam` — the seam's sweep (readers
  // gone or settled without a pass reveal; an `on` re-arm resolves).
  declare static _catch:
    ((node: Computed<any>, flags: number, error: unknown) => boolean) | undefined;
  declare static _fresh: ((node: Computed<any>) => unknown) | undefined;
  declare static _hidden: ((r: Computed<any>) => boolean) | undefined;
  declare static _boundarySeam: (() => void) | undefined;
  // `_heldRun` — a queued run under a fallback-showing boundary waits for
  // the reveal (true: held; the boundary re-queues it by type). The
  // synchronous first render on creation builds the subtree, attached or
  // not; its updates and the user effects wait.
  declare static _heldRun: ((node: Computed<any>) => boolean) | undefined;

  flush() {
    if (this._running) return;
    this._running = true;
    // A28: companions of nodes written since the last flush mirror the
    // flushed world — re-synced inside the running window (the write is
    // "flushed" from here on).
    resyncUnflushedCompanions();
    passLane = null;
    passTx = null;
    try {
      // Sweep before the heap: unobserved() pulls swept nodes out of it, so
      // a dormant memo dirtied in the same tick is reclaimed instead of
      // recomputed; late subscribers (an effect reading a swept memo this
      // flush) revive it, which is the pay-for-use contract.
      sweepDormant();
      runHeap(dirtyQueue, GlobalQueue._update);
      this.settle();
      clock++;
      // A write the commit sweep staged with no subscriber to dirty is work
      // too — the next round commits it.
      scheduled = dirtyQueue._max >= dirtyQueue._min || pendingNodes.length !== 0;
      this.run(EFFECT_RENDER);
      this.run(EFFECT_USER);
      if (__OBSERVE__ && holding) {
        holding = false;
        attrHooks!.holdEnd();
      }
      if (__DEV__ && !scheduled) {
        // Fully drained: no staged value may survive this point unqueued or
        // unheld.
        devCheckQuiescent(
          n => pendingNodes.includes(n) || (n._config & (CONFIG_HELD | CONFIG_OVERRIDE)) !== 0
        );
      }
      if (__DEV__) DEV.hooks.onUpdate?.();
    } finally {
      this._running = false;
      passTx = null;
    }
  }
  /** L2 — the seam: end of the pure phase. Commit this flush's staged nodes,
   * or park them with the transaction the flush joined; then land every
   * transaction no frame is waiting on. The landing flush is an ordinary
   * flush: the settle walk (async.ts) re-ran the parked readers in its pure
   * phase, and here no flight the transaction holds has a frame deriving
   * from it (`blocked`). */
  settle(): void {
    // Lanes: an ended action body judges its guesses now that their passes
    // have run (lanes.ts); a correction's re-derivations run in one more
    // pure round — the parent's flights before the parent is judged below.
    if (GlobalQueue._laneCorrections?.()) runHeap(dirtyQueue, GlobalQueue._update);
    const joined = flushTransaction;
    flushTransaction = null;
    // The frame's verdict is in: the guesses written since the last seam
    // open their lane under the frame's transaction (a lane's own flush
    // parents a nested lane to it), or are dropped — the frame commits, and
    // there is nothing to be optimistic over. Their passes run next round;
    // a parent landing at this very seam ends the lane before they do.
    GlobalQueue._applyGuesses?.(joined);
    // A lane's own flush (its flight landing, its reveal) parks nothing: the
    // lane's work reached it per pass; the frame's plain writes commit.
    // (Resolved: a guess over another transaction's guess merged them.)
    const t = joined !== null && !joined._lane ? resolveTx(joined) : null;
    if (t !== null) {
      // `t._nodes` grows under the walk (holdFrame pushes); the bound is
      // this flush's list, which does not.
      const count = pendingNodes.length;
      for (let i = 0; i < count; i++) {
        const n = pendingNodes[i];
        // Already held: the pass that re-staged it joined its transaction,
        // which is `t` (or merged into it). Lane work is the lane's (a
        // pending mark propagated onto it queued it here too).
        if (
          !(n._config & (CONFIG_HELD | CONFIG_OVERRIDE)) &&
          (n._x === null || n._x._transaction === null || !n._x._transaction._lane)
        ) {
          // A loading source — pending with nothing staged and no committed
          // value (A16, A19 exc. 1: uninitialized is loading, not pending)
          // that is not an observer — is nobody's frame: not held. Its
          // first landing is commit #0, not a resumption of this frame, and
          // a write that reaches it later overlaps nothing (#2937: the
          // stale stamp was the bridge that entangled unrelated updates
          // with a never-resolving flight). Its observers are held and
          // wait on its flight (`blocked`).
          if (
            n._pendingValue === NOT_PENDING &&
            (n as Computed<any>)._statusFlags & STATUS_UNINITIALIZED &&
            !((n as Computed<any>)._statusFlags & STATUS_ERROR) &&
            (n as any)._type !== EFFECT_RENDER
          )
            continue;
          // A34 (2): a tick whose writes net to the committed value made no
          // proposal (`setShow(false); setShow(true)` on a committed true) —
          // not staged, not held, pends nothing; a later write to it is
          // plain mainline. (A node already held stays held when written
          // back: A34 (1).)
          if (
            n._pendingValue !== NOT_PENDING &&
            !(n._config & CONFIG_COMMITTED_ERROR) &&
            !((n as Computed<any>)._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED)) &&
            n._equals &&
            n._equals(n._value, n._pendingValue) &&
            n._x?._pendingFirstChild == null &&
            n._x?._pendingDisposal == null
          ) {
            n._pendingValue = NOT_PENDING;
            n._config &= ~CONFIG_STAGED;
            continue;
          }
          holdNode(n, t);
        }
        // A held pass's frame is held with it (ruling A, O2): the children it
        // created are the transaction's — they compute, and a pass over them
        // or a write that reaches them joins; they effect at the landing.
        if (n._config & CONFIG_STAGED) holdFrame(n as unknown as Owner, t);
      }
      pendingNodes.length = 0;
      GlobalQueue._storePark?.(t);

      // (This flush's runs are stashed with `t` below — after the landings,
      // so a `t` that lands at this very seam runs them first, ahead of
      // the runs it held from earlier flushes.)
      // The batch joins: the writes that dirtied these are held with it — a
      // zombie never displays that world. A verdict reader among them does
      // (#3444: `latest()` inside a branch a held Show is removing peers
      // through like the same read outside): it re-runs now, as the
      // holder's verdict lane's work — before the lane seams, which reveal
      // it (nothing commits this seam that could dispose it).
      const zombies = deferredZombies.splice(0).sort((a, b) => a._height - b._height);
      for (let i = 0; i < zombies.length; i++)
        if (
          (zombies[i]._flags & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE)) === REACTIVE_ZOMBIE &&
          zombies[i]._config & CONFIG_VERDICT
        )
          recompute(zombies[i]);
      // The unchanged passes' tails stay linked (A30, #3469): their inputs
      // are held, and the committed frame still derives from them — no trim.
    } else {
      commitPendingNodes();
      // The flush committed: an unchanged pass's stale tail goes now. Not
      // after a later pass this flush that threw (NotReady included — it
      // keeps its full list, `_depsTail` marking where it stopped) or that
      // left an effect owing a run (`runEffect` trims when the run applies):
      // `recompute`'s own gates.
      for (let i = 0; i < heldTrims.length; i++) {
        const t = heldTrims[i];
        if (t._x?._error == null && !(t as any)._modified) trimStaleDeps(t);
      }
    }
    // The list is the flush's either way. Reset only when there is something
    // to reset (`stagedReaders` below likewise): `length = 0` is a runtime
    // call even on an empty array, and the plain flush — no unchanged pass,
    // no lane work — has nothing in either.
    if (heldTrims.length) heldTrims.length = 0;
    // Lanes: a blocked one parks its frame (its own flight is up); an
    // unblocked one reveals this round's work. Then land every transaction
    // no frame is waiting on — its lanes end with it. Backwards: a landing
    // removes its entry.
    // This flush's own runs, the lanes' reveals, and the landings' held runs
    // are collected apart and ordered below.
    const own = this._queues;
    const lanes: [QueueCallback[], QueueCallback[]] = (this._queues = [[], []]);
    // The passes that read this frame's stagings as the screen read held
    // writes if it parked: the lane seam re-derives them on the committed
    // world (a lane's runs wait this round).
    GlobalQueue._laneSeams?.(t !== null ? stagedReaders : null);
    if (stagedReaders.length) stagedReaders.length = 0;
    this._queues = [[], []];
    for (let k = transactions.length - 1; k >= 0; k--) {
      const u = transactions[k];
      if (blocked(u)) continue;
      transactions.splice(k, 1);
      GlobalQueue._endLanes?.(u);
      land(u);
      // A landing's commits can dispose a zombie a transaction judged above
      // was blocked on (#3463: live "until the commit that disposes it") —
      // judge them again.
      k = transactions.length;
    }
    // The store folds the pending backings whose container nodes committed
    // — this flush's, or a landing's (store/store.ts installs it).
    GlobalQueue._storeCommit?.();
    // Marks declared outside a transaction: the flush that carried them
    // parked (something async below) — the window is the frame's, the marks
    // are its transaction's; else they release at the seam, verdict-only,
    // nothing to show (affects.ts).
    GlobalQueue._releaseAmbientMarks?.(t !== null && transactions.indexOf(t) !== -1 ? t : null);
    // The effect phase: lane work first (displayed ahead of the frame), then
    // this flush's runs, then the runs the landings held from earlier
    // flushes — as one pass would have queued them (#3540: a shell
    // re-derived at the landing before a boundary swap held since the
    // write; #3528: a display-ahead swap before the count it is shown
    // beside). A parked frame's runs wait with its transaction instead: the
    // effect phase applies a committed frame.
    const u = t && liveTx(t);
    const parked = u !== null;
    // Attribution hook: this flush found its transaction incomplete — its
    // writes stay staged, its runs are stashed below. Before the effect
    // phase (the lanes' display-ahead runs are the visible acknowledgers);
    // `holdEnd` fires after it (`flush`).
    if (__OBSERVE__ && parked && attrHooks !== null) {
      attrHooks.holdStart(u!);
      holding = true;
    }
    for (let i = 0; i < 2; i++) {
      if (parked) append(u!._queues[i], own[i]);
      // The plain flush — no reveal, no landing, not parked — has nothing to
      // order around its own runs: they are the queue as they stand (the
      // same array, not a copy; `run` takes it whole). Every other seam
      // builds the ordered queue above.
      this._queues[i] =
        parked || lanes[i].length || this._queues[i].length
          ? lanes[i].concat(parked ? [] : own[i], this._queues[i])
          : own[i];
    }
    if (deferredZombies.length !== 0) {
      // Survivors are the displayed frame of a held pass: they rerun for the
      // live write, parents before children.
      const zombies = deferredZombies.splice(0).sort((a, b) => a._height - b._height);
      for (let i = 0; i < zombies.length; i++) {
        if (!(zombies[i]._flags & REACTIVE_DISPOSED)) recompute(zombies[i]);
      }
    }
    // Boundaries: readers that settled, landed or died this flush are
    // dropped; a fallback with none left reveals next round.
    GlobalQueue._boundarySeam?.();
  }
  run(type: number) {
    const effects = this._queues[type - 1];
    if (effects.length) {
      this._queues[type - 1] = [];
      runQueue(effects, type);
    }
  }
  enqueue(type: number, fn: QueueCallback, lane: Transaction | null = passLane): void {
    // Lane work's runs are the lane's: they run at its reveal, not with
    // the frame (which may park). A lane pass that read the frame's own
    // staging is the frame's (`recompute` passes null): its run waits with
    // the frame.
    if (type) (lane !== null ? lane : this)._queues[type - 1].push(fn);
    schedule();
  }
  /** Status reaching the root: pending is absorbed (the root mount defers —
   * dev records it for the ASYNC_OUTSIDE_LOADING_BOUNDARY FYI); an error is
   * unhandled (`false` → the caller halts).
   *
   * L2: this is where a transaction is registered. Pending that reaches an
   * observer (a render effect: the frame) is a frame that cannot show — the
   * flush parks, and the transaction waits on the flight while a frame
   * derives from it (`blocked`). Pending nobody observes holds nothing: a
   * memo in flight that no frame reads is not a frame waiting. (Base: the
   * queue's `_asyncReporters`, INV-3's one registration site.)
   *
   * A boundary between the observer and the root (boundaries.ts) is asked
   * first: a fallback catches what is not ready under it, and the root
   * never hears of it. */
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean {
    if (GlobalQueue._catch && GlobalQueue._catch(node, flags & mask, error)) return true;
    if (mask & STATUS_PENDING) {
      if (flags & STATUS_PENDING) {
        if (__DEV__ && _enforceLoadingBoundary) _hitUnhandledAsync = true;
        // A pass that went pending holds its frame: the async's own
        // synchronous frame is not ready (A15 reveal corollary: a reveal
        // that discovers a flight whose inputs are visible holds and joins
        // it; one whose inputs are held is a stale reader and never gets
        // here — `read` serves it the committed value). The frame's, not the
        // observer's: a render effect belongs to whoever dirtied its pass
        // (A15 shared-hole, #3407) — one held by T1 and re-run by T2's write
        // pends for T2's flight, and the two stay parallel; a frame that is
        // T1's already joined T1 through the write or the memo that made it
        // so. Outside a flush — root setup, a mount — the frame is the
        // mount's: its pending observers are one transaction, and a flight
        // started in it resumes it when it lands (maintainer, #3461: "part
        // of the same one"); what the mount published synchronously stays
        // published. Lane work going pending holds the lane, not the frame:
        // `blocked(lane)` finds it in the lane's staging ("if further async
        // downstream is hit it holds like its own transition").
        if (passLane === null) joinFuture(null);
      }
      return true;
    }
    return false;
  }
}

/** A15's stale readers: a frame whose LAST pass read a held node as
 * committed re-derives on the landed world — next round, after the commits.
 * One re-derived since (any later pass cleared the bit: in the transaction,
 * or without the held read) owes nothing. A run this transaction stashed
 * for it is void (#3322: an effect has one value slot, and the stale pass
 * overwrote the value that run was for) — the re-derivation's run replaces
 * it. */
export function reruns(u: Transaction): void {
  for (let i = 0; i < u._reruns.length; i++) {
    const r = u._reruns[i];
    if (r._flags & REACTIVE_DISPOSED) continue;
    if (r._flags & REACTIVE_FRAME_READ) {
      r._flags &= ~REACTIVE_FRAME_READ;
      (r as any)._modified = false;
      // Its frame is replaced by the re-derivation: a run one of its
      // children queued this flush (re-run by the same landing) is for the
      // frame being replaced — void too (#3404).
      for (let c = r._firstChild; c !== null; c = c._nextSibling)
        if ((c as any)._type) (c as any)._modified = false;
      enqueueSub(r);
    }
  }
  u._reruns.length = 0;
}

/** The landing: the held frame becomes the frame. */
function land(u: Transaction): void {
  // Attribution hook: judged complete — its held writes commit next
  // (`_nodes` still lists them).
  if (__OBSERVE__ && attrHooks !== null) attrHooks.transitionSettled(u);
  reruns(u);
  if (u._marks !== null) GlobalQueue._releaseMarks!(u._marks);
  // Old children die in the commits (cleanups first), then the stashed
  // effects run ahead of this flush's own. A node a lane took over since
  // (a guess written over the staged truth) is the lane's to land.
  for (let i = 0; i < u._nodes.length; i++) {
    const n = u._nodes[i];
    if (n._x!._transaction === null || txOf(n) !== u) continue;
    n._x!._transaction = null;
    commitPendingNode(n);
  }
  releaseQueues(u);
}

/** The held runs join this flush's effect phase after its own runs (the
 * landing's re-passes, in height order): the frame's effects run as one
 * pass would have queued them — a shell re-derived at the landing before a
 * boundary swap held since the write (#3540's log order). */
export function releaseQueues(u: Transaction): void {
  for (let i = 0; i < 2; i++) {
    append(globalQueue._queues[i], u._queues[i]);
    u._queues[i] = [];
  }
}

/** `a.push(...b)` without the argument-count limit. */
function append<T>(a: T[], b: T[]): void {
  for (let i = 0; i < b.length; i++) a.push(b[i]);
}

/** Nodes staged this flush (`_pendingValue` set), committed at its end. */
const pendingNodes: Signal<any>[] = [];
/** Passes that read a staging of this flush as the screen — lane work
 * (core.ts `stagedRead`), a verdict reader before the frame's verdict
 * (verdict.ts): if the frame parks they read a held write — re-derived next
 * round (lanes.ts; a lane's runs wait that round). */
export const stagedReaders: Computed<any>[] = [];

/** A15's stale reader: `c` was served the committed value of a node `t`
 * holds (a render effect, a verdict reader, lane work) and is re-derived
 * after `t`'s landing (`_reruns`). Once per pass. */
export function staleReader(c: Computed<any>, t: Transaction): void {
  if (!(c._flags & REACTIVE_FRAME_READ)) {
    c._flags |= REACTIVE_FRAME_READ;
    t._reruns.push(c);
  }
}

export function queuePendingNode(node: Signal<any>): void {
  if (__DEV__) lastStagedNodeName = (node as any)._name ?? null;
  pendingNodes.push(node);
  if (!globalQueue._running) markUnflushedStaged(); // A28
}

// Dev-only attribution for the flush loop guard (#3140): when the guard
// trips, naming what the loop kept chewing on lets the app author attribute
// the runaway without patching dist.
let lastStagedNodeName: string | null = null;

/** §12d: bumped by every recompute and every new subscriber edge. A node's
 * staged-rewrite skip is sound only while NOTHING recomputed or linked since
 * its last notify — a mid-batch pull can clean a marked subscriber, and a
 * skipped re-write would leave it stale. */
export let notifyEpoch = 0;
export function bumpNotifyEpoch(): void {
  notifyEpoch++;
}

export function insertSubs(node: Signal<any> | Computed<any>): void {
  // §12d: stamp before walking — setSignal's staged-rewrite fast path skips
  // the next walk for this node while the epoch holds (marking is idempotent).
  node._notifiedAt = notifyEpoch;
  // Presence bits gate the optional-slot probes (see constants.ts): one
  // masked read of the always-present _config instead of missing-property
  // lookups in the hottest notify loop.
  const cfg = (node as any)._config as number;
  const hasSnapshot =
    (cfg & CONFIG_HAS_SNAPSHOT) !== 0 && (node as any)._x?._snapshotValue !== undefined;

  // Observe-tier fan-out: this walk visits every subscriber edge anyway, so
  // the graph-size count is one local increment here and no field anywhere.
  let fanOut = 0;
  for (let s = node._subs; s !== null; s = s._nextSub) {
    const sub = s._sub;
    if (__OBSERVE__) fanOut++;
    // Missed-wake latch (#3037): this write is landing while the subscriber
    // is mid-recompute (a nested pull committing beneath its reads), and the
    // heap refuses RECOMPUTING nodes. A gen-current link means the pass
    // already validated this dep — the value it read is now stale — so latch
    // for recompute's tail to reschedule. Untouched links need no latch (the
    // pass either re-reads them fresh or trims them), and neither does the
    // tail link: it is the read IN FLIGHT — read() links before it pulls, so
    // this very commit is what that read returns.
    if (sub._flags & REACTIVE_RECOMPUTING_DEPS && s._gen === sub._depGen && s !== sub._depsTail)
      sub._flags |= REACTIVE_MISSED_WAKE;
    if (hasSnapshot && sub._config & CONFIG_IN_SNAPSHOT_SCOPE) {
      sub._flags |= REACTIVE_SNAPSHOT_STALE;
      continue;
    }
    enqueueSub(sub);
  }
  if (__OBSERVE__ && fanOut >= GRAPH_SIZE_WARN_AT) noteFanOut(node, fanOut);
}

/** Lane work re-staged (lanes.ts; `recompute`): the lane's members among
 * its subscribers re-derive as the lane's work (REACTIVE_LANE_DIRTY), their
 * runs held with it — not as stale readers republishing the committed view
 * (#3460). After `insertSubs`. A render effect on no lane is marked too:
 * inert for its pass (`recompute` seats a lane only from its own `_x`), it
 * is a live write if the effect becomes a zombie later this flush — an
 * on-screen reader whose removal an adopted write stages follows the lane
 * (the lane-membership ruling, 2026-10-05; `_update`). */
export function laneDirty(node: Signal<any> | Computed<any>, l: Transaction): void {
  for (let s = node._subs; s !== null; s = s._nextSub) {
    const t = s._sub._x?._transaction;
    if (t?._lane ? sameLane(t, l) : (s._sub as any)._type) s._sub._flags |= REACTIVE_LANE_DIRTY;
  }
}
/** One lane, or two of one link group (#3335): one reveal unit. */
export function sameLane(a: Transaction, b: Transaction): boolean {
  return a === b || (a._links !== null && a._links === b._links);
}

/** Publish the terminal outcome with the frame, never with a pending retry. */
export function publishError(n: Signal<any> | Computed<any>, error: unknown): void {
  if (error !== undefined) {
    n._x!._committedError = error;
    n._config |= CONFIG_COMMITTED_ERROR;
  } else if (n._config & CONFIG_COMMITTED_ERROR) {
    n._x!._committedError = undefined;
    n._config &= ~CONFIG_COMMITTED_ERROR;
  }
}

export function commitStatus(n: Computed<any>): void {
  // A manual proposal is a successful answer even while the derivation's
  // request remains pending. Publish it just as the successful-payload path
  // does; the pending request still owns availability and its eventual answer.
  if (!(n._statusFlags & STATUS_PENDING) || n._flags & REACTIVE_MANUAL_WRITE) {
    publishError(n, n._statusFlags & STATUS_ERROR ? n._x!._error : undefined);
    n._statusFlags &= ~STATUS_UNINITIALIZED;
  }
  // A committing frame ends the loading window, including a direct first
  // failure before the first flush. Keep successful seed history separately.
  n._loading = false;
}

export function commitPendingNode(n: Signal<any>): void {
  const c = n as Partial<Computed<unknown>>;
  // L2: the commit is where a pass, held or not, stops being uncommitted —
  // unless it has no answer yet. A pass still in flight (pending, nothing
  // staged) stays uncommitted: a re-pass disposes its children on the spot,
  // and the frame it parked stays the frame until a pass of this node
  // commits a value.
  if (!c._fn) {
    n._config &= ~(CONFIG_STAGED | CONFIG_HELD);
    if (n._pendingValue !== NOT_PENDING) {
      n._value = n._pendingValue as any;
      n._pendingValue = NOT_PENDING;
    }
    return;
  }
  // Computeds only from here (`_statusFlags` is not a signal field). A
  // commit beneath a flight publishes its inputs (A15 reveal corollary,
  // #3305): a reveal of it must observe, not show the pre-flight value.
  const inFlight = n._pendingValue === NOT_PENDING && (c._statusFlags! & STATUS_PENDING) !== 0;
  n._config = inFlight
    ? (n._config & ~CONFIG_HELD) | CONFIG_INPUTS_PUBLISHED
    : n._config & ~(CONFIG_HELD | CONFIG_STAGED | CONFIG_INPUTS_PUBLISHED);
  if (n._pendingValue !== NOT_PENDING) {
    n._value = n._pendingValue as any;
    n._pendingValue = NOT_PENDING;
    // A node born staged (recompute) initializes at this commit.
    c._statusFlags! &= ~STATUS_UNINITIALIZED;
    // A quiet re-ask's classification survives its landing and dies with
    // the landed value's commit (A19 exc. 2, #3178): verdict-quiet through
    // the reveal. (The sweep of a node still in flight is not a landing.)
    // The A28 stash goes with it.
    if (c._x != null) ((c._x._reask = false), (c._x._flushed = NOT_PENDING));
    // An effect with a staged value was born held (L2): its first run is
    // this commit's, not its creation's (A29) — queue it now.
    if ((n as any)._type && (n as any)._type !== EFFECT_TRACKED) {
      (n as any)._modified = true;
      globalQueue.enqueue(
        (n as any)._type,
        ((n as any)._boundRunEffect ??= GlobalQueue._runEffect.bind(null, c as Computed<unknown>))
      );
    }
  }
  // Publish status after the payload and before dependency disposal can call
  // user code. Effect enqueueing above cannot execute its callback inline.
  commitStatus(c as Computed<any>);
  c._flags! &= ~REACTIVE_MANUAL_WRITE;
  // The dependencies of the pass that produced the value are the frame's now:
  // the previous frame's tail goes (A30, #3410; `recompute` left it for a
  // staged pass). Only after a clean pass: `_error` is cleared by a clean
  // pass or by the node's own landing (whose pass was clean), so a set
  // `_error` means the last pass threw, kept its full list, and `_depsTail`
  // marks where it stopped.
  if (c._x?._error == null) trimStaleDeps(c as Computed<unknown>);
  // L2: the children this commit publishes are the frame's now — the frame
  // they replace, parked by the pass (`recompute`), goes.
  if (
    !inFlight &&
    c._x != null &&
    (c._x._pendingFirstChild !== null || c._x._pendingDisposal !== null)
  )
    GlobalQueue._dispose(c as Computed<unknown>, false, true);
}

function commitPendingNodes() {
  for (let i = 0; i < pendingNodes.length; i++) {
    const n = pendingNodes[i];
    // A node a lane pass re-staged this round is the lane's to reveal; one
    // a transaction holds (born held by a mainline pass, `passTx`) is that
    // transaction's to commit, at its landing.
    if (!(n._config & (CONFIG_OVERRIDE | CONFIG_HELD))) commitPendingNode(n);
  }
  pendingNodes.length = 0;
}

export const globalQueue = new GlobalQueue();

/**
 * Synchronously processes the pending reactive queue, or runs `fn` in a synchronous
 * flush scope before draining the queue.
 *
 * Reactive updates are normally batched onto the microtask queue, so multiple
 * writes in a row collapse into a single update pass. Call `flush()` when you
 * need to *observe* the result of those writes synchronously — most commonly
 * in tests, but also at the boundary of imperative integration code. Pass a
 * callback when the writes themselves should bypass microtask scheduling and
 * drain synchronously when the callback returns.
 *
 * @example
 * ```ts
 * const [count, setCount] = createSignal(0);
 * const doubled = createMemo(() => count() * 2);
 *
 * setCount(5);
 * flush();
 * expect(doubled()).toBe(10);
 *
 * flush(() => setCount(6));
 * expect(doubled()).toBe(12);
 *
 * // Nested flushes drain at each level:
 * flush(() => {
 *   setCount(7);
 *   flush(() => setCount(8)); // inner drain — effects fire here
 *   // outer continues with up-to-date state
 * });
 * ```
 */
export function flush(): void;
export function flush<T>(fn: () => T): T;
export function flush<T>(fn?: () => T): T | void {
  if (actionDepth > 0) {
    if (__DEV__) {
      throw new Error(
        "[FLUSH_IN_ACTION] flush() inside an action body is not allowed. An action's writes are held in its " +
          "transaction and commit when the action settles: flush() cannot reveal them, and draining here would " +
          "detach the writes that follow from the transaction. Remove the flush(); to observe the result, read " +
          "after the action resolves."
      );
    }
    return fn ? fn() : undefined;
  }
  if (fn) {
    syncDepth++;
    try {
      return fn();
    } finally {
      // Decrement even if the drain throws (a throwing effect): a leaked
      // syncDepth would stop `schedule()` from ever queuing a microtask again.
      try {
        flush();
      } finally {
        syncDepth--;
      }
    }
  }
  if (globalQueue._running) {
    if (__DEV__ && inTrackedQueueCallback) {
      throw new Error(
        "Cannot call flush() from inside onSettled or createTrackedEffect. flush() is not reentrant there. " +
          "Writes made here are processed in the same flush's continuation; to force a drain afterwards, defer it: queueMicrotask(() => flush())."
      );
    }
    if (__DEV__ && inEffectCallback) {
      const message =
        "[FLUSH_IN_EFFECT_CALLBACK] flush() called from inside an effect callback is a no-op: the flush that runs effects is already in progress. " +
        "Writes made here are processed in the same flush's continuation; to force a drain afterwards, defer it: queueMicrotask(() => flush()).";
      reportDiagnostic(
        emitDiagnostic({
          code: "FLUSH_IN_EFFECT_CALLBACK",
          kind: "lifecycle",
          severity: "warn",
          message
        })
      );
    }
    return;
  }
  if (halted) return;
  let count = 0;
  // Attribution: whether this call drained anything, so `flushEnd` fires once
  // per real drain and never for a no-op call. The declaration is dead in
  // prod (its only write is behind __OBSERVE__) and rollup drops it.
  let drained = false;
  // The drain's opening instant, under the loop's own condition so it fires
  // exactly when `flushEnd` below will. Outside every try (see the rule in
  // attribution-hooks.ts).
  if (__OBSERVE__ && attrHooks !== null && scheduled) attrHooks.flushStart();
  while (scheduled) {
    if (__DEV__ && ++count === 1e5) {
      // Attribution beats a bare guard (#3140): say what kept the loop alive.
      throw new Error(
        `Potential Infinite Loop Detected. Kept alive by scheduled work${
          lastStagedNodeName ? `; last staged node: ${lastStagedNodeName}` : ""
        }`
      );
    }
    globalQueue.flush();
    if (__OBSERVE__) drained = true;
  }
  // Outside every try in this function (see the rule in attribution-hooks.ts):
  // the drain loop above is the one place all scheduled work funnels through,
  // so this is the "committed and effects ran" instant for everything the
  // loop processed.
  if (__OBSERVE__ && drained && attrHooks !== null) attrHooks.flushEnd();
}

function runQueue(queue: QueueCallback[], type: number): void {
  for (let i = 0; i < queue.length; i++) queue[i](type);
}
