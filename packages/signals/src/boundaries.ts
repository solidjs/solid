/**
 * Boundaries — the display consumers between a frame reader and the root:
 * `createLoadingBoundary` (`<Loading>`) and `createErrorBoundary`
 * (`<Errored>`).
 *
 * A boundary is an owner whose context names it (`BOUNDARY`), so every node
 * created under it finds it in O(1) and the enclosing boundaries through
 * `_parent`; a `tree` (the content, flattened) and an `output` that shows
 * the tree or the fallback. The output is a frame reader (CONFIG_REDERIVE):
 * status reaching it from its content re-derives it instead of marking it,
 * and its pass decides.
 *
 * Status protocol (B5). A frame reader under a boundary that goes pending or
 * errors tells `GlobalQueue.notify`, which asks `catchStatus` before the
 * root: the nearest boundary of that status that is collecting — an error
 * boundary always; a loading boundary that has not shown content yet, or
 * whose `on` just changed — records the reader and shows its fallback, and
 * the root never hears of it (no transaction is opened: A33, a fallback-
 * caught flight holds nothing). A loading boundary showing content forwards:
 * the root holds the frame as for any reader. The tree's own status takes
 * the same route from the output's pass (`read(tree)` throws it).
 *
 * The hold (`blocked`, scheduler.ts) asks `hidden`: a reader behind a
 * fallback — any boundary on its chain whose last pass chose the fallback —
 * is not on screen and holds nothing. An error boundary flipping to its
 * fallback is the same as a loading one resetting: every reader under it
 * stops counting, and a flight whose only visible reader that was loses its
 * hold (maintainer, 2026-10-01).
 *
 * Reveal. The seam (`boundarySeam`) drops readers that settled, died, or
 * landed and committed; a fallback with none left re-derives its output,
 * which reads the tree again. A reader that landed but is held (CONFIG_HELD,
 * its value staged in a transaction) is not settled: the content reveals at
 * the commit, with the rest of the frame (#3540).
 *
 * `on` (loading only): a tracked function whose reads re-arm the boundary.
 * A pass of it after the mount arms the boundary for the flush: anything
 * pending under it — already (its forwarded readers), or going pending later
 * in the same heap — is collected and the fallback shows now, with the
 * change's frame; nothing pending, and the arm is a no-op at the seam.
 */
import {
  CONFIG_REDERIVE,
  CONFIG_HELD,
  CONFIG_OVERRIDE,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_DISPOSED,
  REACTIVE_LANE_READ,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./core/constants.js";
import { computed, read, recompute, runWithOwner, setSignal, signal } from "./core/core.js";
import { emitDiagnostic, reportDiagnostic } from "./core/dev.js";
import { NotReadyError, unwrapStatusError } from "./core/error.js";
import { reportClientError } from "./core/error-hooks.js";
import { link } from "./core/graph.js";
import { enqueueSub } from "./core/heap.js";
import { cleanup, createOwner, getOwner } from "./core/owner.js";
import {
  flushTransaction,
  GlobalQueue,
  globalQueue,
  haltReactivity,
  joinFuture,
  passLane,
  schedule,
  setPassLane,
  txOf,
  type Transaction
} from "./core/scheduler.js";
import type { Computed, Owner, Signal } from "./core/types.js";
import { flatten } from "./flatten.js";
import { accessor, type Accessor } from "./signals.js";

interface Boundary {
  /** STATUS_PENDING (loading) or STATUS_ERROR. */
  _type: number;
  _parent: Boundary | null;
  _owner: Owner;
  _tree: Computed<any>;
  /** Null during the output's first pass (its post-check decides then). */
  _output: Computed<any> | null;
  /** Frame readers under it carrying its status: caught, or (loading,
   * showing content) forwarded — the `on` re-arm collects those. */
  _readers: Set<Computed<any>>;
  /** Loading: has shown content. Fresh again after an `on` re-arm found
   * something pending. */
  _initialized: boolean;
  /** Loading: `on` changed this flush — collecting until the seam. */
  _armed: boolean;
  /** The lane the arming pass was work of (a display-ahead read in `on`:
   * `latest`, `isPending`): the swap it causes is that lane's — shown now,
   * beside the held frame — not the frame's. `_lane` is set when the arm
   * flips the boundary and consumed by the swap pass. */
  _armLane: Transaction | null;
  _lane: Transaction | null;
  /** DEV: the arm was display-ahead (a lane) — the fallback shows now,
   * whatever holds the frame; no LOADING_ON_OUTSIDE_HOLD report. */
  _ahead?: boolean;
  /** The output's last pass chose the fallback: readers under it are off
   * screen (`hidden`). */
  _fallback: boolean;
  /** User effects whose run came due behind the fallback: re-queued at the
   * reveal (`heldRun`). */
  _runs: Set<Computed<any>> | null;
  /** Reveal order (reveal.ts): the controller that owns this slot until it
   * has shown content, and the state it forces — the fallback (`_gated`),
   * or nothing at all (`_collapsed`). */
  _reveal: object | null;
  _gated: boolean;
  _collapsed: boolean;
  _error: Signal<unknown> | null;
  _show: (b: Boundary) => unknown;
}

/** Context key: the nearest boundary of a node, inherited at creation. */
const BOUNDARY = Symbol(__DEV__ ? "boundary" : "");
/** Context key: the reveal controller a Loading boundary created here is a
 * slot of (reveal.ts); a boundary clears it for its content — only direct
 * children are slots. */
export const REVEAL = Symbol(__DEV__ ? "reveal" : "");

/** Reveal order (reveal.ts), installed when something imports
 * `createRevealOrder`: a Loading boundary registers as a slot of the
 * controller in its context, tells it when its readiness changed, and
 * leaves it when it has shown content. */
export interface RevealHooks {
  _register(controller: object, b: Boundary): void;
  _unregister(controller: object, b: Boundary): void;
  _changed(controller: object): void;
}
export let revealHooks: RevealHooks | null = null;
export function setRevealHooks(h: RevealHooks): void {
  revealHooks = h;
}
export type { Boundary };

/** Boundaries with readers to sweep (or an arm to resolve) at the seam. */
const collecting = new Set<Boundary>();

const boundaryOf = (node: Owner): Boundary | undefined =>
  node._context[BOUNDARY] as Boundary | undefined;

/** Catches what reaches it: an error boundary always; a loading one until it
 * has shown content, or while re-armed. */
const isCollecting = (b: Boundary): boolean =>
  b._type === STATUS_ERROR || !b._initialized || b._armed;

/** The reader goes to the fallback: recorded, and the output re-derives
 * (a no-op while the output's own pass is running — its post-check
 * decides). */
function caught(b: Boundary, node: Computed<any>, error: unknown): void {
  if (b._type === STATUS_ERROR) {
    // An error boundary waits on what THREW (`StatusError.source`), not on
    // the reader that saw it: the reader recovers the moment a refetch
    // starts (its boundary catches the pending), while the error is settled
    // only when its source is neither errored nor in flight. `reset` re-runs
    // the same node.
    error ??= node._x?._error;
    node = (error as { source?: Computed<any> })?.source ?? node;
    const caught = unwrapStatusError(error);
    setSignal(b._error!, caught);
    reportClientError(caught, b._owner, node);
  }
  b._readers.add(node);
  collecting.add(b);
  if (b._armed) flip(b);
  // Already showing the fallback: one more reader to wait on changes
  // nothing on screen. The fallback is instantiated once per show — a later
  // error reaches it through the `error` accessor, which is why it is one.
  if (!b._fallback) redraw(b);
  if (b._reveal !== null) revealHooks!._changed(b._reveal);
}

/** A re-armed boundary found something pending: fresh again, and the swap
 * the arming pass asked for is that pass's lane's (if any). */
function flip(b: Boundary): void {
  b._initialized = false;
  b._lane = b._armLane;
}

export function redraw(b: Boundary): void {
  if (b._output !== null && !(b._output._flags & (REACTIVE_DISPOSED | REACTIVE_ZOMBIE))) {
    enqueueSub(b._output);
    schedule();
  }
}

/** GlobalQueue._catch: status from a frame reader, nearest boundary first.
 * A loading boundary on the way records a pending reader whether or not it
 * catches it (its `on` may collect it later). */
function catchStatus(node: Computed<any>, flags: number, error: unknown): boolean {
  if (flags === 0) {
    // A status cleared. Judged by the node's status now, against each
    // boundary's own rule (`unsettled`) — the error path clears pending
    // first and the node is still errored then. The last reader a fallback
    // waited on settling re-derives the output now, in the same heap (a
    // held reader's landing has joined its transaction, so the content
    // lands with its run, not a round after). Others still waiting: nothing
    // on screen changes, the fallback stays as it is.
    if (collecting.size !== 0)
      for (let b = boundaryOf(node); b !== undefined; b = b._parent ?? undefined)
        if (
          !(node._statusFlags & unsettled(b)) &&
          b._readers.delete(node) &&
          b._readers.size === 0
        ) {
          if (b._fallback) redraw(b);
          if (b._reveal !== null) revealHooks!._changed(b._reveal);
        }
    return false;
  }
  for (let b = boundaryOf(node); b !== undefined; b = b._parent ?? undefined) {
    if (!(b._type & flags)) continue;
    if (isCollecting(b)) {
      caught(b, node, error);
      return true;
    }
    b._readers.add(node);
    collecting.add(b);
  }
  return false;
}

/** The nearest boundary on `r`'s chain showing its fallback, if any. */
function hiddenBy(r: Computed<any>): Boundary | undefined {
  for (let b = boundaryOf(r); b !== undefined; b = b._parent ?? undefined)
    if (b._fallback) return b;
  return undefined;
}

/** GlobalQueue._hidden: behind a fallback. */
function hidden(r: Computed<any>): boolean {
  return hiddenBy(r) !== undefined;
}

/** GlobalQueue._heldRun: a queued run behind a fallback waits for the reveal
 * (maintainer, 2026-10-02: the queue is held, the synchronous first render
 * goes through). A user effect's, which would read a DOM that is not
 * attached ("many depend on reading the DOM, something that can't happen
 * off screen"); a render effect's update too — a Portal or a head-tag
 * library writes outside the hidden subtree, and a queued render run is
 * what mounts them. A user effect's first run is scheduled like every other,
 * so a mount under a fallback defers it too; a render effect's first run is
 * synchronous on creation and never comes here. The run's `_modified` stays
 * set; the reveal re-queues it by type (`release`), and a boundary above
 * still showing its fallback holds it again then. */
function heldRun(node: Computed<any>): boolean {
  const b = hiddenBy(node);
  if (b === undefined) return false;
  (b._runs ??= new Set()).add(node);
  return true;
}

/** The reveal: the runs held behind the fallback are this flush's, each in
 * its own phase — render updates with the frame that attaches the content,
 * user effects after it. */
function release(b: Boundary): void {
  if (b._runs === null) return;
  for (const n of b._runs) {
    const type = (n as any)._type;
    globalQueue.enqueue(
      type === EFFECT_TRACKED ? EFFECT_USER : type,
      type === EFFECT_TRACKED
        ? (n as any)._run
        : ((n as any)._boundRunEffect ??= GlobalQueue._runEffect.bind(null, n))
    );
  }
  b._runs = null;
}

/** Drop the readers that settled or died. Settled: a loading reader no
 * longer pending; an error's source neither errored nor in flight. A reader
 * that landed but is held (its value staged in a transaction) is not: the
 * content reveals at the commit, with its run. The tree is: the output reads
 * it and enters the transaction itself (its committed value shows until the
 * landing). */
const unsettled = (b: Boundary): number =>
  b._type === STATUS_ERROR ? STATUS_ERROR | STATUS_PENDING : STATUS_PENDING;

export function prune(b: Boundary, pass: boolean): number {
  const mask = unsettled(b);
  for (const r of b._readers) {
    if (r._flags & REACTIVE_DISPOSED) b._readers.delete(r);
    else if (!(r._statusFlags & mask)) {
      if (r !== b._tree && (r._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD) {
        // Landed, held: the content is that transaction's — the output's
        // pass enters it and the reveal lands with the reader's run. The
        // seam, past its park decision, waits for the commit instead. (A
        // lane's reader reveals with the lane, this round.)
        if (!pass) continue;
        joinFuture(txOf(r));
      }
      b._readers.delete(r);
    }
  }
  return b._readers.size;
}

/** Reveal order: a slot is ready when its content can show — it has shown
 * content, or nothing under it is unready (the tree neither pending nor
 * born held, no reader waited on). */
export function ready(b: Boundary): boolean {
  return (
    b._initialized ||
    (!(b._tree._statusFlags & STATUS_PENDING) &&
      !(
        b._tree._config & CONFIG_HELD &&
        (b._output === null || b._output._statusFlags & STATUS_UNINITIALIZED)
      ) &&
      prune(b, false) === 0)
  );
}

/** GlobalQueue._boundarySeam, end of the seam: readers that settled, died,
 * or landed and committed are dropped; a fallback with none left reveals
 * next round. An arm resolves: nothing collected, nothing happened. */
function boundarySeam(): void {
  for (const b of collecting) {
    const flags = b._output!._flags;
    if (flags & REACTIVE_DISPOSED) {
      collecting.delete(b);
      continue;
    }
    // A parked frame's boundary (zombie) keeps its state for its revival.
    if (flags & REACTIVE_ZOMBIE) continue;
    prune(b, false);
    if (__DEV__ && b._armed && !b._initialized && !b._ahead) reportOutsideHold(b);
    b._armed = false;
    if (b._readers.size === 0) {
      collecting.delete(b);
      if (b._fallback) redraw(b);
      if (b._reveal !== null) revealHooks!._changed(b._reveal);
    }
  }
}

/** DEV, at the re-arm that flipped a boundary to its fallback: a source it
 * now waits on is also read by a frame reader outside it — the frame waits
 * on the very source, and the fallback can never be seen. Structural, so
 * reported once, at the change, naming the source; a display-ahead arm
 * (`latest()` in `on`) is the user's choice and not reported. */
function reportOutsideHold(b: Boundary): void {
  // A frame reader of the source outside `b`: a render effect, or another
  // boundary's tree (its output forwards the pending to the frame) — reading
  // it directly or through one pending memo (a boundary's content memo).
  const outside = (reader: Computed<any>, hop: boolean): boolean => {
    if (!(reader._statusFlags & STATUS_PENDING) || reader._flags & REACTIVE_DISPOSED) return false;
    if ((reader as any)._type !== EFFECT_RENDER && boundaryOf(reader)?._tree !== reader) {
      if (hop)
        for (let s = reader._subs; s !== null; s = s._nextSub)
          if (outside(s._sub, false)) return true;
      return false;
    }
    if (hidden(reader)) return false;
    for (let o = boundaryOf(reader); o !== undefined; o = o._parent ?? undefined)
      if (o === b) return false;
    return true;
  };
  for (const r of b._readers) {
    const sources = r._x?._pendingSources;
    if (sources === undefined) continue;
    for (const source of sources) {
      for (let s = source._subs; s !== null; s = s._nextSub) {
        if (!outside(s._sub, true)) continue;
        const name = (source as any)._name as string | undefined;
        reportDiagnostic(
          emitDiagnostic(
            {
              code: "LOADING_ON_OUTSIDE_HOLD",
              kind: "async",
              severity: "warn",
              message:
                "[LOADING_ON_OUTSIDE_HOLD] `on` re-armed a Loading boundary, but " +
                `${
                  name ? `\`${name}\`` : "a source it is waiting on"
                } is also read outside it and holds the frame: the fallback can never be seen — the frame waits on the very source the boundary is waiting on. ` +
                "Move the outside read under the boundary so one hold owns the data. (Reading `latest()` in `on` shows the fallback now, beside the held frame.)",
              nodeName: name,
              data: { source: name }
            },
            b._owner
          )
        );
        return;
      }
    }
  }
}

/** The `on` pass is a verdict's: it probed itself (CONFIG_VERDICT), or it
 * read a memo that did (#3528's `createMemo(() => isPending(m2))`) — its
 * swap is display-ahead either way. */
function verdictDerived(c: Computed<any>): boolean {
  if (c._config & CONFIG_VERDICT) return true;
  for (let d = c._deps; d !== null; d = d._nextDep)
    if (d._dep._config & CONFIG_VERDICT) return true;
  return false;
}

/** `on` changed after the mount: fresh again if anything under it is
 * pending now; collecting for the rest of the flush either way. */
function arm(b: Boundary): void {
  if (!b._initialized) {
    // Already re-armed and on its fallback, as the frame's work — and the
    // `on` pass arms again as lane work: its verdict was provisional (a
    // memo of `isPending(m2)` is a watcher until the flush parks, then the
    // holder's verdict lane's — verdict.ts), and the swap it asked for is
    // display-ahead after all (#3528). Re-home the swap: the output re-runs
    // as the lane's, shown now beside the held frame.
    if (b._fallback && b._lane === null && b._armLane === null && passLane !== null) {
      b._armLane = b._lane = passLane;
      if (__DEV__) b._ahead = true;
      // The swap the frame's pass staged (held with the frame) is void: the
      // lane's pass stages it anew, as a watcher's provisional value is
      // voided at the seam (verdict.ts `verdictSeam`).
      if (b._output !== null) b._output._pendingValue = NOT_PENDING;
      redraw(b);
    }
    return;
  }
  b._armed = true;
  // A verdict read in `on` (`isPending`) whose frame has no transaction
  // yet: the swap is still display-ahead — the frame gets one now (it lands
  // at this very seam if nothing holds it), and the swap is its verdict
  // lane's work, shown ahead of the frame's own runs (#3528).
  let lane = passLane;
  if (lane === null && globalQueue._running && verdictDerived(getOwner() as Computed<any>)) {
    joinFuture(null);
    lane = GlobalQueue._verdictLane!(flushTransaction!);
  }
  b._armLane = lane;
  if (__DEV__) b._ahead = lane !== null;
  collecting.add(b);
  for (const r of b._readers) {
    if (r._statusFlags & STATUS_PENDING && !(r._flags & REACTIVE_DISPOSED)) {
      flip(b);
      redraw(b);
      return;
    }
  }
}

/** The error boundary's `reset`: re-run what threw (a comparator throw
 * names a signal — nothing to re-run). */
function reset(b: Boundary): void {
  // A snapshot: a source failing again is caught — and re-added — mid-walk.
  for (const r of [...b._readers])
    if (r._fn !== undefined && !(r._flags & REACTIVE_DISPOSED)) recompute(r);
  schedule();
}

function createBoundary<T>(
  type: number,
  fn: () => T,
  show: (b: Boundary) => T,
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
  const b: Boundary = {
    _type: type,
    _parent: boundaryOf(owner) ?? null,
    _owner: owner,
    _tree: null!,
    _output: null,
    _readers: new Set(),
    _initialized: false,
    _armed: false,
    _armLane: null,
    _lane: null,
    _fallback: false,
    _runs: null,
    _reveal: null,
    _gated: false,
    _collapsed: false,
    _error: type === STATUS_ERROR ? signal<unknown>(undefined, ERROR_SIGNAL) : null,
    _show: show
  };
  const controller = type === STATUS_PENDING ? (owner._context[REVEAL] as object | null) : null;
  if (getOwner())
    cleanup(() => {
      collecting.delete(b);
      if (controller) revealHooks!._unregister(controller, b);
    });
  // The `on` dependencies live OUTSIDE the boundary, as the condition of a
  // `<Show>` wrapping it would: created before the owner's context names it.
  // A source of it going pending re-runs it (CONFIG_REDERIVE) rather than
  // marking it: the pass catches the NotReady — it is a notification, it
  // does not suspend the parent — and re-arms.
  if (onFn) {
    let mounted = false;
    runWithOwner(owner, () =>
      computed(() => {
        try {
          onFn();
        } catch (e) {
          if (!(e instanceof NotReadyError)) {
            if (!globalQueue.notify(getOwner() as Computed<any>, STATUS_ERROR, STATUS_ERROR, e)) {
              haltReactivity(e);
              throw e;
            }
            return;
          }
        }
        if (mounted) arm(b);
        else mounted = true;
      })
    )._config |= CONFIG_REDERIVE;
  }
  const context: Record<symbol | string, unknown> = { ...owner._context, [BOUNDARY]: b };
  if (revealHooks !== null) context[REVEAL] = null;
  owner._context = context;
  const tree = runWithOwner(owner, () => {
    const c = __OBSERVE__ ? computed(fn, { name: "children" }) : computed(fn);
    return __OBSERVE__
      ? computed(() => flatten(read(c)), { name: "boundary" })
      : computed(() => flatten(read(c)));
  });
  b._tree = tree;
  // A slot of the reveal order in its context (reveal.ts): gated until the
  // controller releases it — before the output's first pass.
  if (controller) revealHooks!._register(controller, b);
  const output = computed<T>(
    (): T => {
      // Reveal order (reveal.ts): a gated slot shows its fallback — or, in a
      // collapsed tail, nothing — whatever its content's state; the
      // controller is told the pass ran (its readiness may have changed) and
      // releases it in turn.
      if (b._gated) {
        // Linked without being read: the tree settling (or changing)
        // re-derives this pass, which is how the controller hears of it.
        // It may release this very slot (the frontier whose content just
        // settled): the pass goes on to show it — the redraw it asks for is
        // refused mid-pass and not needed.
        link(tree, getOwner() as Computed<any>);
        if (b._reveal !== null) revealHooks!._changed(b._reveal);
        if (b._gated) {
          if (b._collapsed) {
            b._fallback = true;
            return undefined as T;
          }
          return fallback(b);
        }
      }
      // A tree carrying a status is not read: an errored memo's reactive
      // re-read retries it (`read`), and neither a fallback re-rendering nor
      // passing the error by may re-run the content; a pending one read as
      // lane work would serve its committed value (A31) — the swap a
      // display-ahead `on` causes is the lane's, and must still be the
      // fallback. Linked, so its recovery re-derives this pass; read again
      // once clean.
      const status = tree._statusFlags & (STATUS_PENDING | STATUS_ERROR);
      if (status !== 0) {
        link(tree, getOwner() as Computed<any>);
        if (status & type) {
          if (isCollecting(b)) {
            caught(b, tree, undefined);
            return fallback(b);
          }
          // Forwarded: a loading boundary showing content keeps it and
          // holds the frame like any reader (recorded for its `on`).
          b._readers.add(tree);
          collecting.add(b);
        }
        // A pending passes an error boundary by (A6); an error, a loading
        // one; a loading boundary showing content forwards its pending.
        throw tree._x!._error;
      }
      if (isCollecting(b)) {
        // A29's boundary exemption (#3540): a boundary MOUNTED over a held
        // value (its first pass; the tree born held) shows its fallback now
        // and the content at the commit — entering the transaction would
        // make the output itself born held, and nothing would show until
        // the commit. (The seam keeps a held reader until it is committed.)
        // A boundary with a committed value reads a held tree and enters:
        // the outside sees its committed value until the landing, which
        // reveals the content — a fallback staged earlier is replaced ahead
        // of the commit and never shown.
        const self = getOwner() as Computed<any>;
        if (
          tree._config & CONFIG_HELD &&
          self._statusFlags & STATUS_UNINITIALIZED &&
          !(self._config & CONFIG_HELD)
        ) {
          // The seam re-derives this pass once; by then the fallback is
          // the committed value, and the next pass enters.
          collecting.add(b);
          return fallback(b);
        }
        // Readers under it still unready: the fallback, the tree untouched.
        // The seam re-derives this pass when they settle.
        if (prune(b, true) !== 0) return fallback(b);
      }
      let value: T;
      try {
        value = read(tree);
      } catch (e) {
        if (e instanceof NotReadyError ? type === STATUS_PENDING : type === STATUS_ERROR) {
          if (isCollecting(b)) {
            caught(b, tree, e);
            return fallback(b);
          }
          // Forwarded: a loading boundary showing content keeps it and
          // holds the frame like any reader (recorded for its `on`).
          b._readers.add(tree);
          collecting.add(b);
        }
        // A pending passes an error boundary by (A6).
        throw e;
      }
      // Readers under it still unready (caught before, or while the read
      // ran the content at a mount): the fallback.
      if (isCollecting(b) && b._readers.size !== 0) return fallback(b);
      b._initialized = true;
      b._fallback = false;
      release(b);
      // Shown: the slot leaves its reveal order (a later re-arm gates nobody
      // else; the frontier moves on).
      if (b._reveal !== null) {
        const controller = b._reveal;
        b._reveal = null;
        revealHooks!._changed(controller);
      }
      return value;
    },
    // Boundary structure, not a user source: its value is fallback-or-content
    // and legitimately swaps mid-hydration (resume), so it must never be
    // frozen by snapshot capture.
    __OBSERVE__ ? { name: "value", _noSnapshot: true } : { _noSnapshot: true }
  );
  output._config |= CONFIG_REDERIVE;
  b._output = output;
  return accessor<T>(output);
}

function fallback<T>(b: Boundary): T {
  // The swap a display-ahead re-arm asked for: this pass is the lane's — a
  // lane read by construction (REACTIVE_LANE_READ: `recompute`'s tail keeps
  // the pass in the lane).
  if (b._lane !== null) {
    setPassLane(b._lane);
    b._output!._flags |= REACTIVE_LANE_READ;
    b._lane = null;
  }
  b._fallback = true;
  return b._show(b) as T;
}

const ERROR_SIGNAL = { ownedWrite: true, _noSnapshot: true } as const;

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
 *   held navigation, not before it. If the same data is also read outside
 *   the boundary, the frame waits on it and the fallback can never be seen
 *   (DEV warns `LOADING_ON_OUTSIDE_HOLD`); the fix is structural — move the
 *   outside read under the boundary so one hold owns the data. A frame held
 *   past the content's landing by something else (the write's action, other
 *   pending data) also shows no fallback; that is a race the fallback may
 *   lose, a legitimate outcome, and not reported. A display-ahead read in
 *   `on` (`latest()`) shows the fallback now, beside the held frame; that
 *   is a capability, not the recommended shape. Optimistic writes and a
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
  return createBoundary<T | U>(STATUS_PENDING, fn, () => fallback(), options?.on);
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
  fallback: (error: Accessor<unknown>, reset: () => void) => U
): Accessor<T | U> {
  return createBoundary<T | U>(STATUS_ERROR, fn, b => fallback(accessor(b._error), () => reset(b)));
}

// Installed at module evaluation — present exactly when something imports a
// boundary. An app without one pays the three null checks and nothing else.
GlobalQueue._catch = catchStatus;
GlobalQueue._hidden = hidden;
GlobalQueue._boundarySeam = boundarySeam;
GlobalQueue._heldRun = heldRun;
