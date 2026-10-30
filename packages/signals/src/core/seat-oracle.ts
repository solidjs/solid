/**
 * The old read-side deciders as ONE pure function — the shadow's oracle for
 * the swap (S1 M2, `documentation/plans/reader-seat-rebuild.md` §5).
 *
 * `oldSlot` is a transliteration of the deciders `slot()` replaced, as they
 * stood at the M1 re-baseline (commit 4c413e1ea): `read`'s fast block and
 * slow path, `serve`, `frameRead`, `stagedScreen`, `stagedRead`,
 * `readerSeesCommitted`, `verdictValue` with `verdictRead` / `route` /
 * `observeFlight` / `provisionalVerdict` / `pendingVerdict` / `watchVerdict`
 * / `heldLatest`, `laneRead` with `enterLane` and the store's `foldedRead`
 * arm. Every mechanism they fired is a bit of the raise (seat.ts); every
 * state they mutated mid-read (`passLane`, the pass's flags, the flush's
 * transaction) is simulated locally. Nothing here touches a node.
 *
 * `__TEST__` only: nothing imports it but `seat.ts`'s shadow.
 */
import {
  CONFIG_AUTHORITATIVE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_IN_SNAPSHOT_SCOPE,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_OVERRIDE,
  CONFIG_PROMOTED,
  CONFIG_STAGED_ERROR,
  CONFIG_VERDICT,
  EFFECT_RENDER,
  NOT_PENDING,
  REACTIVE_JOINED,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_STAGED_READ,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { snapshotCaptureActive, strictRead, unflushedStaged } from "./core.js";
import { laneGuessed } from "./lanes.js";
import {
  clock,
  flushTransaction,
  globalQueue,
  GlobalQueue,
  seatRowsHook,
  laneSeamsHook,
  laneStageHook,
  latestOpened,
  passLane,
  resolveTx,
  sameLane,
  txOf,
  verdictApplyHook,
  type Transaction
} from "./scheduler.js";
import {
  MARK_AH,
  MARK_ENTERED,
  MARK_JF0,
  MARK_JFT,
  MARK_LANE_READ,
  MARK_LATE,
  MARK_LEAVE,
  MARK_LINK,
  MARK_LST,
  MARK_OBS,
  MARK_PR,
  MARK_SERVED,
  MARK_ST,
  MARK_UNANS,
  MARK_W,
  RAISE_FL,
  RAISE_H,
  RAISE_HAT,
  RAISE_LANE,
  RAISE_VSEAT,
  SLOT_C,
  SLOT_DV,
  SLOT_E,
  SLOT_ESHOWN,
  SLOT_ESTAGED,
  SLOT_FOLD,
  SLOT_LV,
  SLOT_NONE,
  SLOT_NR,
  SLOT_NR0,
  SLOT_P,
  SLOT_RETRY,
  SLOT_SNAPSHOT,
  SLOT_STASH,
  SLOT_T,
  WINDOW_LATEST,
  WINDOW_PROBE,
  bornInto
} from "./seat.js";
import type { Computed, Owner, Root, Signal } from "./types.js";

type AnyNode = Signal<any> | Computed<any>;

export interface OldDecision {
  slot: number;
  raise: number;
  tx: Transaction | null;
  lane: Transaction | null;
}
// (Literal: the module may evaluate before seat.ts in a bundle — the cycle.)
const out: OldDecision = { slot: 0, raise: 0, tx: null, lane: null };

// Simulated pass state for one decision.
let flags = 0;
let pl: Transaction | null = null;
/** The flush's transaction, or null; `opened` once a simulated
 * `joinFuture(null)` would have opened one (its identity unknown: the
 * table names null too). */
let flush: Transaction | null = null;
let opened = false;
let c: Computed<any> | null = null;
let el: AnyNode = null!;
let owner: Computed<any> = null!;
let tracking = false;
let spectating = false;
let probing = false;
let latestActive = false;

function mark(bit: number, tx?: Transaction | null): void {
  out.raise |= bit;
  if (tx !== undefined) out.tx = tx;
}
function decide(slot: number): OldDecision {
  out.slot = slot;
  return out;
}

function creatorPass(o: Owner | null): Computed<any> | null {
  return o !== null && (o as Root)._root
    ? (o as Root)._parentComputed
    : (o as Computed<any> | null);
}
function creatorReads(p: Computed<any> | null, born: number): number {
  return (p = creatorPass(p!._parent))?._flags! & REACTIVE_RECOMPUTING_DEPS
    ? creatorReads(p, born | p!._flags)
    : born & (REACTIVE_JOINED | REACTIVE_STAGED_READ);
}
function under(l: Transaction, a: Transaction): boolean {
  for (let t = l._parent; t !== null && t._lane; t = t._parent) if (t === a) return true;
  return false;
}
function unflushedValue(n: AnyNode): unknown {
  if (globalQueue._running || n._pendingValue === NOT_PENDING || n._config & CONFIG_PROMOTED)
    return NOT_PENDING;
  if (n._config & CONFIG_HELD) return n._x!._flushedAt === clock ? n._x!._flushed : NOT_PENDING;
  return n._value;
}
function laneValueNP(n: AnyNode): boolean {
  if (!(n._config & CONFIG_GUESS) && n._pendingValue !== NOT_PENDING) return false;
  return (
    n._x!._lane === NOT_PENDING && ((n as Computed<any>)._statusFlags & STATUS_UNINITIALIZED) !== 0
  );
}
function displayNP(n: AnyNode): boolean {
  const x = n._x!;
  return (
    !(x._transaction!._shown && x._lane !== NOT_PENDING) &&
    ((n as Computed<any>)._statusFlags & STATUS_UNINITIALIZED) !== 0
  );
}
function quietPending(n: Computed<any>): boolean {
  const x = n._x;
  if (!x) return false;
  if (x._pendingSources) {
    for (const source of x._pendingSources) if (!source._x?._reask) return false;
    return true;
  }
  return x._reask;
}

// ── core.ts ──────────────────────────────────────────────────────────────

function joinPass(): void {
  flags |= REACTIVE_JOINED;
  mark(RAISE_H);
}
function joinPassAt(t: Transaction): void {
  flags |= REACTIVE_JOINED;
  mark(RAISE_H | RAISE_HAT, t);
}
function stagedRead(n?: AnyNode): void {
  if (!((n as Computed<any> | undefined)?._statusFlags! & STATUS_UNINITIALIZED)) {
    flags |= REACTIVE_STAGED_READ;
    mark(RAISE_FL);
    if (laneSeamsHook && (pl !== null || ((c as any)._type && c!._config & CONFIG_VERDICT)))
      mark(MARK_W);
  }
}
function stagedScreen(): boolean {
  if (flush === null || bornInto(c!, flush)) return false;
  if (
    verdictApplyHook &&
    flush === latestOpened &&
    pl === null &&
    c!._config & CONFIG_VERDICT &&
    !(c!._statusFlags & STATUS_UNINITIALIZED)
  ) {
    mark(MARK_W);
    return false;
  }
  mark(MARK_ST, flush);
  return true;
}
function frameRead(): boolean {
  const verdict = verdictApplyHook && c!._config & CONFIG_VERDICT;
  const lane = laneStageHook && pl !== null;
  if (
    (!lane || (c!._statusFlags & STATUS_UNINITIALIZED && owner._statusFlags & STATUS_PENDING)) &&
    !verdict &&
    (!(c!._config & (EFFECT_RENDER << 23)) || el._config & CONFIG_INPUTS_PUBLISHED)
  )
    return false;
  const t = txOf(el);
  if ((t === flush && !lane && !verdict) || bornInto(c!, t)) return false;
  mark(MARK_ST, t);
  if (lane || verdict) mark(MARK_SERVED);
  return true;
}
function readerSeesCommitted(r: Computed<any> | null): boolean {
  return (!r ||
    el._pendingValue === NOT_PENDING ||
    r._config & CONFIG_CHILDREN_FORBIDDEN) as boolean;
}
/** `serve(el, c)`: the slot (a throw is a slot). */
function serve(r: Computed<any> | null): number {
  if (
    el._pendingValue !== NOT_PENDING &&
    owner._statusFlags & STATUS_UNINITIALIZED &&
    (!r || spectating || r._config & CONFIG_CHILDREN_FORBIDDEN)
  )
    return SLOT_NR0;
  const u = r && unflushedStaged ? unflushedValue(el) : NOT_PENDING;
  if (u !== NOT_PENDING) {
    mark(MARK_LATE);
    return el._config & CONFIG_HELD ? SLOT_STASH : SLOT_C;
  }
  if (readerSeesCommitted(r)) return SLOT_C;
  if (
    verdictApplyHook &&
    r!._config & CONFIG_VERDICT &&
    !(owner._statusFlags & STATUS_UNINITIALIZED) &&
    stagedScreen()
  )
    return el._x?._shownError ? SLOT_ESHOWN : SLOT_C;
  stagedRead(el);
  return el._config & CONFIG_STAGED_ERROR ? SLOT_ESTAGED : SLOT_P;
}
function throwShown(): boolean {
  return !!(el as Computed<any>)._x?._shownError;
}

// ── verdict.ts ───────────────────────────────────────────────────────────

/** The verdict lane of a transaction `joinFuture(null)` is about to open:
 * its identity is unknown here (the table names null too); the seat is
 * non-null from the route on, which is all a later arm of the read asks. */
const OPENED = {} as Transaction;
function route(t: Transaction | null): void {
  mark(MARK_AH, t);
  if (!pl && !(flags & (REACTIVE_JOINED | REACTIVE_STAGED_READ)))
    pl = t !== null ? (t._verdict ?? t) : OPENED;
}
function verdictRead(t: Transaction | null, plain?: boolean): void {
  route(t);
  if (plain) mark(MARK_ST, t);
  else if (probing) mark(MARK_PR);
}
function watchVerdict(unanswered = false): void {
  mark(MARK_W | (unanswered ? MARK_UNANS : 0));
}
function provisionalVerdict(notFinal: boolean): void {
  if (flush || opened) {
    verdictRead(flush);
    if (probing && flags & REACTIVE_STAGED_READ) watchVerdict();
    return;
  }
  watchVerdict(!probing || notFinal);
}
function pendingVerdict(r: Computed<any> | null): void {
  if (owner._statusFlags & STATUS_UNINITIALIZED) return;
  if (r && tracking) {
    if (el._config & CONFIG_HELD) verdictRead(txOf(el));
    else if (globalQueue._running) {
      if (!probing) {
        mark(MARK_JF0);
        opened = true;
      }
      provisionalVerdict(false);
    }
  }
}
function observeFlight(): boolean {
  if (el._config & CONFIG_INPUTS_PUBLISHED || (el._config & CONFIG_HELD && bornInto(c!, txOf(el))))
    return false;
  if (globalQueue._running) {
    mark(MARK_JF0);
    opened = true;
    if (!(el._config & CONFIG_HELD)) mark(MARK_OBS);
    verdictRead(flush, true);
  }
  return true;
}

function oldVerdictValue(): OldDecision {
  const owned = !!c && !(c._config & CONFIG_CHILDREN_FORBIDDEN);
  const tracked = owned && tracking;
  if (probing && GlobalQueue._marked?.(owner)) {
    if (tracked && flush) verdictRead(flush);
  }
  if (
    el._config & CONFIG_OVERRIDE &&
    !(owner._statusFlags & STATUS_ERROR && !(el._config & CONFIG_GUESS))
  ) {
    const l = txOf(el),
      flying = (owner._statusFlags & STATUS_PENDING) !== 0 && !quietPending(owner),
      guess = el._config & CONFIG_GUESS,
      np = guess ? false : latestActive && !flying ? laneValueNP(el) : displayNP(el);
    if (!np) {
      if (tracked) verdictRead(l._parent ?? l);
      if (guess) {
        if (latestActive && l.folded) return decide(SLOT_FOLD);
        return decide(SLOT_LV);
      }
      // (`display(el) === el._value` with the node uninitialized: the lane's
      // value is the committed one.)
      if (
        flying &&
        el._x!._lane === el._value &&
        owner._statusFlags & STATUS_UNINITIALIZED &&
        (latestActive || !owner._x!._shownError)
      )
        return decide(SLOT_NR);
      return decide(latestActive && !flying ? SLOT_LV : SLOT_DV);
    }
  }
  const uninitialized = (owner._statusFlags & STATUS_UNINITIALIZED) !== 0;
  if (el._config & CONFIG_HELD) {
    if (!uninitialized) {
      const t = txOf(el);
      if (
        tracked &&
        !probing &&
        (c as any)._type === EFFECT_RENDER &&
        !pl &&
        t._verdict?._held &&
        flush !== t
      ) {
        mark(MARK_ST, t._verdict);
        return decide(SLOT_C);
      }
      if (tracked) verdictRead(t);
      if (latestActive && el._pendingValue !== NOT_PENDING) {
        if (!tracked && flush && !globalQueue._running) mark(MARK_JFT);
        const u = unflushedValue(el);
        if (u !== NOT_PENDING) {
          if (tracked) mark(MARK_LATE);
          return decide(SLOT_STASH);
        }
        return decide(el._config & CONFIG_STAGED_ERROR ? SLOT_ESTAGED : SLOT_P);
      }
      return decide(SLOT_C);
    }
    if (el._pendingValue !== NOT_PENDING && !(owner._statusFlags & STATUS_PENDING)) {
      if (probing && owned) joinPass();
      return decide(el._config & CONFIG_STAGED_ERROR ? SLOT_ESTAGED : SLOT_P);
    }
  } else if (el._pendingValue !== NOT_PENDING) {
    if (owner._statusFlags & STATUS_PENDING && !uninitialized) pendingVerdict(tracked ? c : null);
    else if (tracked && globalQueue._running) provisionalVerdict(!latestActive && !uninitialized);
    else if (tracked && probing) watchVerdict();
    if (latestActive) {
      if (globalQueue._running)
        return decide(el._config & CONFIG_STAGED_ERROR ? SLOT_ESTAGED : SLOT_P);
      if (c) mark(MARK_LATE);
    }
    return decide(SLOT_C);
  }
  if (owner._statusFlags & STATUS_PENDING) {
    if (!uninitialized) {
      pendingVerdict(tracked ? c : null);
      return decide(SLOT_C);
    }
    if (c && !tracking && !spectating && el !== c) mark(MARK_LINK);
    return decide(SLOT_NR);
  }
  if ((el as any)._fn && owner._statusFlags & STATUS_ERROR) return decide(SLOT_E);
  return decide(SLOT_C);
}

// ── lanes.ts ─────────────────────────────────────────────────────────────

function enterLane(l: Transaction): void {
  mark(MARK_LANE_READ);
  const f = flags,
    p = pl;
  const verdict = l._parent!._verdict === l;
  const move = (): void => {
    pl = l;
    out.raise |= verdict ? RAISE_VSEAT : RAISE_LANE;
    out.lane = l;
    if (verdict) out.tx = l._parent;
  };
  if (p === null) {
    if (!(verdict && creatorReads(c, (c as any)._type || f))) {
      move();
      if (f & REACTIVE_STAGED_READ && (laneGuessed() || verdict || f & REACTIVE_JOINED))
        stagedRead();
    }
  } else if (sameLane(p, l)) move();
  else if (!under(p, l)) move();
}
/** `laneRead(c, el)`: a slot, or SLOT_NONE for NOT_PENDING (read goes on). */
function laneRead(): number {
  const guess = el._config & CONFIG_GUESS;
  const l = txOf(el);
  if (c !== null && l.folded) {
    // store/optimistic.ts `foldedRead(c, el)`
    if (
      guess &&
      pl === null &&
      (c as any)._type !== EFFECT_RENDER &&
      !(c._config & CONFIG_CHILDREN_FORBIDDEN) &&
      (el as any)._host?.fam?.node !== c
    ) {
      joinPassAt(resolveTx(l._parent ?? l));
      return SLOT_FOLD;
    }
  }
  if (c !== null && c._config & CONFIG_AUTHORITATIVE) return SLOT_T;
  const status = owner._statusFlags;
  if (!guess && status & STATUS_ERROR) return SLOT_NONE;
  if (c === null) return laneValueNP(el) ? SLOT_NONE : SLOT_LV;
  const pending = !guess && status & STATUS_PENDING;
  if (!tracking || c._config & CONFIG_CHILDREN_FORBIDDEN) {
    if (pl === null || c._config & CONFIG_CHILDREN_FORBIDDEN)
      return displayNP(el) ? SLOT_NONE : SLOT_DV;
  } else if ((c as any)._type === EFFECT_RENDER) {
    const never = pending && el._x!._lane === NOT_PENDING;
    if ((never || pl !== l) && pl?._parent!._verdict === pl) {
      mark(MARK_LEAVE);
      pl = null;
    }
    if (pl === null || !sameLane(pl, l)) {
      if (never && l._shown) return SLOT_NONE;
      if (
        !guess &&
        el._pendingValue !== NOT_PENDING &&
        c._config & CONFIG_HELD &&
        flush !== null &&
        resolveTx(flush) === txOf(c)
      )
        return SLOT_P;
      if (l._held || pending) {
        out.raise |= MARK_LST;
        out.lane = l;
        return displayNP(el) ? SLOT_NR0 : SLOT_DV;
      }
      if (c._config & CONFIG_VERDICT && l._parent!._verdict !== l) mark(MARK_ENTERED);
    }
  }
  enterLane(l);
  return pending ? SLOT_NONE : SLOT_LV;
}

// ── read ─────────────────────────────────────────────────────────────────

function oldRead(): OldDecision {
  const computed = el as Partial<Computed<unknown>>;
  const cfg = el._config;
  // The fast block (a plain signal: no snapshot, no unflushed staging, not
  // a lane's node, no strict-read scope) — `read`'s first arms.
  if (
    !computed._fn &&
    el._x?._snapshotValue === undefined &&
    !snapshotCaptureActive &&
    (!unflushedStaged || el._pendingValue === NOT_PENDING) &&
    !(cfg & CONFIG_OVERRIDE) &&
    (!__DEV__ || !strictRead)
  ) {
    if (c) {
      if (cfg & CONFIG_HELD && !(c._config & CONFIG_CHILDREN_FORBIDDEN)) {
        if (frameRead()) return decide(SLOT_C);
        joinPass();
      }
    }
    if (!c || el._pendingValue === NOT_PENDING || c._config & CONFIG_CHILDREN_FORBIDDEN)
      return decide(SLOT_C);
    if (
      ((verdictApplyHook && c._config & CONFIG_VERDICT) || (laneStageHook && pl?.folded)) &&
      stagedScreen()
    )
      return decide(SLOT_C);
    stagedRead();
    return decide(SLOT_P);
  }
  let committed = false;
  if (c) {
    if (cfg & CONFIG_HELD && !(cfg & CONFIG_OVERRIDE) && !(c._config & CONFIG_CHILDREN_FORBIDDEN)) {
      if (owner._statusFlags & STATUS_UNINITIALIZED || !frameRead()) joinPass();
      else committed = true;
    }
  }
  if (seatRowsHook && cfg & CONFIG_OVERRIDE) {
    const v = laneRead();
    if (v !== SLOT_NONE) return decide(v);
  }
  // The hydration snapshot (a reader in a snapshot scope): served here,
  // after the hold arms and the lane read, before the rest.
  if (
    snapshotCaptureActive &&
    c &&
    c._config & CONFIG_IN_SNAPSHOT_SCOPE &&
    el._x?._snapshotValue !== undefined &&
    !(owner._statusFlags & STATUS_ERROR)
  )
    return decide(SLOT_SNAPSHOT);
  if (
    laneStageHook &&
    owner._statusFlags & STATUS_PENDING &&
    !committed &&
    !(cfg & CONFIG_OVERRIDE) &&
    !(owner._statusFlags & STATUS_UNINITIALIZED)
  ) {
    if (pl !== null && !(c?._statusFlags! & STATUS_UNINITIALIZED)) committed = true;
    else if (c !== null && c._config & CONFIG_VERDICT) committed = observeFlight();
  }
  if (owner._statusFlags & STATUS_PENDING && !committed) {
    if (c) {
      if (!(c._config & CONFIG_CHILDREN_FORBIDDEN) || owner._statusFlags & STATUS_UNINITIALIZED) {
        if (!tracking && !spectating && el !== c) mark(MARK_LINK);
        return decide(SLOT_NR);
      }
    } else if (owner._statusFlags & STATUS_UNINITIALIZED) return decide(SLOT_NR);
  }
  if (computed._fn && owner._statusFlags & STATUS_ERROR) {
    if (tracking && owner._time < clock) return decide(SLOT_RETRY);
    if (!committed && cfg & CONFIG_STAGED_ERROR) {
      const s = serve(c);
      if (s === SLOT_ESTAGED || s === SLOT_NR0 || s === SLOT_ESHOWN) return decide(s);
    }
    return decide(SLOT_E);
  }
  if ((committed || !c) && throwShown()) return decide(SLOT_ESHOWN);
  return decide(serve(committed ? null : c));
}

/** The old deciders' answer for the read of `el` by `c` (null: no pass):
 * the slot and the mechanisms, as seat.ts spells them. */
export function oldSlot(
  reader: Computed<any> | null,
  node: AnyNode,
  tracked: boolean,
  window: number,
  spectate: boolean
): OldDecision {
  out.slot = SLOT_NONE;
  out.raise = 0;
  out.tx = out.lane = null;
  c = reader;
  el = node;
  owner = node as Computed<any>;
  flags = reader !== null ? reader._flags : 0;
  pl = passLane;
  flush = flushTransaction;
  opened = false;
  tracking = tracked;
  spectating = spectate;
  probing = (window & WINDOW_PROBE) !== 0;
  latestActive = (window & WINDOW_LATEST) !== 0;
  const d = window ? oldVerdictValue() : oldRead();
  c = null;
  el = owner = null!;
  return d;
}
