/**
 * The reader seat — the one answer to "which world does this read see".
 *
 * `slot()` is the decision `read` makes (S1, `documentation/plans/
 * reader-seat-rebuild.md`): posture × node-state bits → a row of the table,
 * which names the slot the read is served from and the mechanisms the read
 * fires (the raise bits). The table decides; `read` (core.ts `applyMarks`,
 * `serveSlot`) applies. The rows for a lane's node live with the lane
 * engine (lanes.ts `laneSlot`, reached through `laneReadHook`) and the
 * rows inside a verdict window with the verdict engine (verdict.ts
 * `windowSlot`): a build without them retains neither.
 *
 * The SEAT this pass reads from is, at S1 M2, a view over the pass state
 * the old deciders kept (`passLane`, the pass's JOINED / STAGED_READ flags,
 * `bornInto`); M3 moves it to the module state `openSeat`/`closeSeat`
 * maintain, which the shadow below already keeps beside it.
 *
 * SHADOW (`__TEST__` only): the seat stack, the born-held decision, and
 * `seat-oracle.ts` — the old deciders ported as a pure function — run
 * beside the table and assert agreement, read by read: the slot, the raise
 * bits, the holds they name; then the world and the lane seat the pass is
 * left in.
 *
 * Vocabulary (the task brief / `reader-seat-brief.md` §4):
 *
 * - World rank — S (screen) < Fl (this flush's staging) < H (the tick's
 *   hold). A read only RAISES (D-1).
 * - Lane — the pass's `seatLane` (today `passLane`): its node's own, or the
 *   creator's on a first pass, or the one a lane read moved it into.
 * - Ahead — the creator was in a lane, or seated as a hold's verdict reader,
 *   when it made this node (F-ahead-posture, ruled 2026-10-28: from a lane
 *   seat, never from a verdict posture alone); D-27: a mount under a
 *   display-ahead reader is mainline, and a first pass reading a staging
 *   under it is born held.
 * - Creator — the running pass (the seat stack's top) when a first pass
 *   opens, for ahead-ness, lane and one-level world (F-mount, reading A);
 *   the branch's world (#4341, D-26 — `creatorsWorld`) is the owner chain's
 *   running passes, as a lazy memo pulled by another owner's pass is not
 *   that pass's branch.
 * - World of a leaf (INV-seat-1 as amended 2026-10-28, D-27): a leaf's
 *   world is its reads' — the screen raises nothing; a born node or the
 *   hold's own staging (L2/L4) is the hold's world, and its children are
 *   born held (#4166).
 * - Posture — the node's OWN, never inherited: F (children-forbidden) > A
 *   (authoritative) > V (verdict reader; Vl/Vp inside a `latest`/`isPending`
 *   window) > L (render effect or CONFIG_FRAME) > D (derivation). No pass:
 *   U.
 *
 * Slots: C `_value` · P `_pendingValue` · Lv the lane's value
 * (`laneValueOf`) · Dv the lane's display (`display`) · T the truth · NR
 * throws NotReady · E throws an error. Serving variants of a slot (which
 * error, which store of the staging) are the SLOT_* constants below.
 *
 * Rows are named as in the brief's table (`U1`…`B2`); a primed row (`D2'`)
 * is a state the table did not spell out, resolved here from the rule the
 * parent row cites and listed in the design document §6 for review.
 */
import {
  CONFIG_AUTHORITATIVE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_FRAME,
  CONFIG_GUESS,
  CONFIG_HELD,
  CONFIG_HELD_FRAME,
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
import {
  clock,
  flushTransaction,
  globalQueue,
  laneReadHook,
  latestOpened,
  passLane,
  passTx,
  resolveTx,
  sameLane,
  txOf,
  verdictApplyHook,
  type Transaction
} from "./scheduler.js";
import type { Computed, Signal } from "./types.js";
import { oldSlot } from "./seat-oracle.js";

type AnyNode = Signal<any> | Computed<any>;

// ─── Vocabulary ────────────────────────────────────────────────────────────

export const WORLD_S = 0;
export const WORLD_FL = 1;
export const WORLD_H = 2;

export const POSTURE_U = 0;
export const POSTURE_D = 1;
export const POSTURE_L = 2;
export const POSTURE_V = 3;
export const POSTURE_VL = 4;
export const POSTURE_VP = 5;
export const POSTURE_A = 6;
export const POSTURE_F = 7;
const POSTURE_NAMES = ["U", "D", "L", "V", "Vl", "Vp", "A", "F"];

export const SLOT_NONE = 0;
export const SLOT_C = 1;
export const SLOT_P = 2;
export const SLOT_LV = 3;
export const SLOT_DV = 4;
export const SLOT_T = 5;
/** NotReady — the node's own (`_x._error`, naming it as the source). */
export const SLOT_NR = 6;
/** The derivation's error (`_x._error`). */
export const SLOT_E = 7;
/** A read served from a hydration snapshot — outside the table. */
export const SLOT_SNAPSHOT = 8;
/** E: the staged error (`_pendingValue`, D-41 `stageError`). */
export const SLOT_ESTAGED = 9;
/** E: the error still shown on screen (`_x._shownError`, D-41). */
export const SLOT_ESHOWN = 10;
/** NR with no source (`new NotReadyError(null)`): a node born staged read
 * by no pass (A19 exc. 1), a lane with nothing shown yet. */
export const SLOT_NR0 = 11;
/** P/C of a folded lane's guess: the hold's world beneath it
 * (store/optimistic.ts `foldedRead(null, el)`). */
export const SLOT_FOLD = 12;
/** P: a held node's flushed stash — the staging the last flush left,
 * rewritten since (A28 `unflushedValue`). */
export const SLOT_STASH = 13;
/** D-41 (#2897): an errored derivation's retry — re-run it and read again. */
export const SLOT_RETRY = 14;
const SLOT_NAMES = [
  "none",
  "C",
  "P",
  "Lv",
  "Dv",
  "T",
  "NR",
  "E",
  "snapshot",
  "E",
  "E",
  "NR",
  "fold",
  "P",
  "retry"
];

/** A packed result: the slot in the low bits, the raise above it (a row
 * with no raise is its slot — a literal in the build). */
export const SLOT_BITS = 5;
export const SLOT_MASK = (1 << SLOT_BITS) - 1;
export const RAISE_MASK = ~SLOT_MASK;

/** The windows open around a read, as bits: `isPending` (a probe) and
 * `latest`. Either alone, or one inside the other: `latest` decides the
 * value (posture Vl), the probe still records its verdict. */
export const WINDOW_PROBE = 1;
export const WINDOW_LATEST = 2;

/** Side effects a row predicts, as a bit set (the raise). */
export const RAISE_FL = 1 << SLOT_BITS;
export const RAISE_H = 2 << SLOT_BITS;
export const RAISE_LANE = 4 << SLOT_BITS;
/** Stale reader of a hold: re-derived at its landing (`staleReader`). */
export const MARK_ST = 8 << SLOT_BITS;
/** Watches the seam (`stagedReaders`). */
export const MARK_W = 16 << SLOT_BITS;
/** Display-ahead: the pass is the hold's verdict lane's (`route`). */
export const MARK_AH = 32 << SLOT_BITS;
/** The tick joins the hold (`joinPassTx`) without the reader's world moving
 * — a leaf reading a born-held derivation (D-4, L4). Shadow seat only. */
export const MARK_TICK = 64 << SLOT_BITS;
/** A leaf's first pass read the hold's staging: born held (B2's leaf
 * clause). Shadow seat only. */
export const MARK_HOLD = 128 << SLOT_BITS;
/** A leaf read a staging of this flush (L1): under a display-ahead mount
 * its first pass is born held (D-27, #4166 — B2's leaf clause, §6).
 * Shadow seat only. */
export const MARK_SR = 256 << SLOT_BITS;
/** The pass enters the hold's verdict seat (a verdict lane's node read as
 * lane work: `enterLane` on the verdict lane). */
export const RAISE_VSEAT = 512 << SLOT_BITS;
/** D-28 (#4275, #4284): a leaf seated as a hold's verdict reader reading a
 * lane that is not that hold's, or a flight never shown, leaves the verdict
 * seat first and reads from the frame's. */
export const MARK_LEAVE = 1024 << SLOT_BITS;
/** A15: lane work or a verdict reader served a held flight's committed value
 * no longer waits on that flight (`laneServed`). */
export const MARK_SERVED = 1 << (11 + SLOT_BITS);
/** A stale reader of a LANE (L7): re-derived at its reveal (`_reruns` of
 * the lane, once per pass — REACTIVE_SCREEN_READ). */
export const MARK_LST = 1 << (12 + SLOT_BITS);
/** The pass read a lane's node as lane work or a verdict reader
 * (REACTIVE_LANE_READ, for `recompute`'s tail). */
export const MARK_LANE_READ = 1 << (13 + SLOT_BITS);
/** A verdict reader entered a lane the seam has not judged (#4284,
 * `entered`): re-derived on the screen if the seam holds the lane. */
export const MARK_ENTERED = 1 << (14 + SLOT_BITS);
/** A verdict reader observed a flight nobody holds (A15, #3458): the flight
 * is queued for the seam as if it had gone pending here. */
export const MARK_OBS = 1 << (15 + SLOT_BITS);
/** The flush's transaction opens if none has (`joinFuture(null)`). */
export const MARK_JF0 = 1 << (16 + SLOT_BITS);
/** An action body's untracked `latest()` of another hold's proposal: the
 * two settle as one (`joinFuture(txOf(el))`, posture C). */
export const MARK_JFT = 1 << (17 + SLOT_BITS);
/** A28: served the committed value over an unflushed write — the pass runs
 * again in the flush that carries it (`markLateLinker`). */
export const MARK_LATE = 1 << (18 + SLOT_BITS);
/** An untracked owned read that throws NotReady still links, so the reader
 * re-runs when the node settles (#3528's exceptions aside). */
export const MARK_LINK = 1 << (19 + SLOT_BITS);
/** The seam's verdict is this probe's own (REACTIVE_PROBE_UNANSWERED): a
 * later plain read must not answer for it. */
export const MARK_UNANS = 1 << (20 + SLOT_BITS);
/** `isPending`'s verdict read: re-derived at the hold's landing
 * (`_reruns`, deduplicated against the last entry). */
export const MARK_PR = 1 << (21 + SLOT_BITS);
/** The join names a hold other than the node's own (`joinPassAt`: a folded
 * guess joins its lane's parent, D-34). */
export const RAISE_HAT = 1 << (22 + SLOT_BITS);
/** The bits the lane engine applies (lanes.ts `laneApply`). */
export const LANE_BITS =
  RAISE_LANE | RAISE_VSEAT | MARK_LEAVE | MARK_LST | MARK_LANE_READ | MARK_ENTERED;
/** The bits the verdict engine applies (verdict.ts `verdictApply`). */
export const VERDICT_BITS = MARK_AH | MARK_PR | MARK_OBS | MARK_JF0 | MARK_JFT;

const RAISE_NAMES: Array<[number, string]> = [
  [RAISE_FL, "Fl"],
  [RAISE_H, "H"],
  [RAISE_HAT, "Hat"],
  [RAISE_LANE, "lane"],
  [RAISE_VSEAT, "vseat"],
  [MARK_ST, "ST"],
  [MARK_W, "W"],
  [MARK_AH, "AH"],
  [MARK_PR, "PR"],
  [MARK_TICK, "tick"],
  [MARK_HOLD, "hold"],
  [MARK_SR, "sr"],
  [MARK_LEAVE, "leave"],
  [MARK_SERVED, "served"],
  [MARK_LST, "LST"],
  [MARK_LANE_READ, "laneRead"],
  [MARK_ENTERED, "entered"],
  [MARK_OBS, "obs"],
  [MARK_JF0, "jf0"],
  [MARK_JFT, "jfT"],
  [MARK_LATE, "late"],
  [MARK_LINK, "link"],
  [MARK_UNANS, "unans"]
];
function raiseNames(r: number): string {
  const out: string[] = [];
  for (const [bit, name] of RAISE_NAMES) if (r & bit) out.push(name);
  return out.length ? out.join("+") : "none";
}
/** The bits the shadow compares against the oracle: everything but the
 * shadow seat's own bookkeeping (tick/hold/sr) and the lane seat moves,
 * compared as the seat after the read. */
const COMPARED =
  RAISE_FL |
  RAISE_H |
  RAISE_HAT |
  MARK_ST |
  MARK_W |
  MARK_AH |
  MARK_PR |
  MARK_LEAVE |
  MARK_SERVED |
  MARK_LST |
  MARK_LANE_READ |
  MARK_ENTERED |
  MARK_OBS |
  MARK_JF0 |
  MARK_JFT |
  MARK_LATE |
  MARK_LINK |
  MARK_UNANS;

// ─── The packed result ─────────────────────────────────────────────────────

/** The row ids are the shadow's vocabulary: folded out of a build
 * without it (`ROW && setRow("D2")`). */
export const ROW: 0 | 1 = __TEST__ ? 1 : 0;

/** The hold the side effects of the last `slot()` name (ST(t), AH(t), the
 * join of a folded guess), and the lane a RAISE_LANE moves the pass into.
 * Module state beside the packed result: no allocation per read. */
export let seatTx: Transaction | null = null;
export let seatLane: Transaction | null = null;
/** The row of the last `slot()` (shadow). */
export let seatRow: string | 0 = 0;

/** The row a result comes from (shadow): `ROW && setRow("D2")` folds out of
 * a build without the shadow. */
export function setRow(row: string | 0): void {
  seatRow = row;
}
/** The hold (and lane) a row's side effects name — set by the rows that
 * carry one; cleared when a decision starts (`slot`, `windowSlot`). */
export function carry(tx: Transaction | null, lane: Transaction | null = null): void {
  seatTx = tx;
  seatLane = lane;
}

// ─── The seat (S1 M2: a view over the pass state the old deciders keep) ───

/** A node born into transaction `t`: held by it and never committed (A29,
 * ruling A) — uninitialized (born held), or a member of the frame one of its
 * held passes built (CONFIG_HELD_FRAME). Its branch exists only in `t`: it
 * has no screen to read, so it reads `t`'s values, whichever flush runs it,
 * and keeps staging (#4010). */
export function bornInto(c: Computed<any>, t: Transaction): unknown {
  return (
    (c._statusFlags & STATUS_UNINITIALIZED || c._config & CONFIG_HELD_FRAME) &&
    c._config & CONFIG_HELD &&
    txOf(c) === t
  );
}

/** The lane a pass is seated in, as the old code spells it: a verdict lane
 * is a seating of posture V, not a lane (verdicts have no node set). */
export function laneOf(t: Transaction | null): Transaction | null {
  return t !== null && t._parent?._verdict === t ? null : t;
}
/** The hold whose verdict reader the running pass sits as. */
export function readerVhold(): Transaction | null {
  return passLane !== null && laneOf(passLane) === null ? resolveTx(passLane._parent!) : null;
}

/** The posture of a node from the node alone (INV-seat-2). `window`: the
 * WINDOW_* bits open (WINDOW_LATEST wins — `latest` inside `isPending` is
 * `latest`'s value). */
export function postureOf(c: Computed<any> | null, window: number): number {
  if (c === null) return window ? (window & WINDOW_LATEST ? POSTURE_VL : POSTURE_VP) : POSTURE_U;
  if (c._config & CONFIG_CHILDREN_FORBIDDEN) return POSTURE_F;
  if (c._config & CONFIG_AUTHORITATIVE) return POSTURE_A;
  if (window) return window & WINDOW_LATEST ? POSTURE_VL : POSTURE_VP;
  // A pass that asked (`latest`/`isPending`) is a verdict reader from the
  // window on, and stays one on every re-run until a pass asks nothing
  // (D-25 "a verdict posture outlives the pass that asked"): the sticky
  // CONFIG_VERDICT, set at the window (`markVerdictReader`). (A verdict
  // reader exists only with the verdict engine installed: a build without
  // it folds the V rows away.)
  if (verdictApplyHook !== null && c._config & CONFIG_VERDICT) return POSTURE_V;
  if ((c as any)._type === EFFECT_RENDER || c._config & CONFIG_FRAME) return POSTURE_L;
  return POSTURE_D;
}

/** A28 — a write not yet flushed: the committed value is what the pass
 * sees, re-run in the flush that carries the write. (A held node rewritten
 * between flushes keeps its flushed stash — `stash`.) */
function unflushed(el: AnyNode): boolean {
  return (
    !globalQueue._running && el._pendingValue !== NOT_PENDING && !(el._config & CONFIG_PROMOTED)
  );
}

/** `laneValueOf(el) === NOT_PENDING`: a lane node with nothing in either
 * view (born in the lane, uninitialized, nothing produced). */
export function laneNP(el: AnyNode, guess: boolean, staged: boolean, uninit: boolean): boolean {
  if (!guess && staged) return false;
  return el._x!._lane === NOT_PENDING && uninit;
}
/** `display(el) === NOT_PENDING`: nothing on screen for a lane node. */
export function dispNP(el: AnyNode, uninit: boolean): boolean {
  const l = el._x!;
  return !(l._transaction!._shown && l._lane !== NOT_PENDING) && uninit;
}

// ─── The slot table (plain rows: U, F, A, L, D, V) ─────────────────────────

/**
 * The slot a plain read of `el` by `c` is served from, with the mechanisms
 * the row fires — `read`'s decision. Pure: nothing on `c` or `el` is
 * touched; `read` applies the raise (core.ts `applyMarks`) and serves the
 * slot (`serveSlot`). A lane's node dispatches to the lane rows first
 * (lanes.ts `laneSlot` through `laneReadHook`); a verdict window's read
 * never arrives here (verdict.ts `windowSlot`).
 *
 * @param c the reader (null: no pass)
 * @param el the node read
 * @param tracked the read is a tracked dependency read (`tracking`)
 * @param spectate a bookkeeping read (`spectating`)
 */
export function slot(
  c: Computed<any> | null,
  el: AnyNode,
  tracked: boolean,
  spectate: boolean
): number {
  // Lane node (CONFIG_OVERRIDE, the lane engine's): the lane rows. Nothing
  // to serve from the lane (a node with nothing in either view): the plain
  // rows go on with the lane's side effects carried — the pass entered.
  seatTx = seatLane = null;
  if (__TEST__) seatRow = 0;
  if (laneReadHook !== null && el._config & CONFIG_OVERRIDE) {
    const r = laneReadHook(c, el, tracked, spectate);
    if (r & SLOT_MASK) return r;
    if (r !== 0) {
      const row = seatRow;
      const p = plainRows(c, el, tracked, spectate);
      if (__TEST__) seatRow = `${row}→${seatRow}`;
      return p | r;
    }
  }
  return plainRows(c, el, tracked, spectate);
}

/** The plain rows (U, F, L, D, V; A as D) — every node but a lane's with a
 * value to serve. */
function plainRows(
  c: Computed<any> | null,
  el: AnyNode,
  tracked: boolean,
  spectate: boolean
): number {
  const cfg = el._config;
  const posture = postureOf(c, 0);
  const st = ((el as Computed<any>)._statusFlags as number | undefined) ?? 0;
  const isFn = typeof (el as Computed<any>)._fn === "function";
  const staged = el._pendingValue !== NOT_PENDING;
  /** (A lane's node — a derivation the lane holds beneath a hold — is the
   * lane's: the hold rows are not its; `read`'s L2 block excluded it.) */
  const held = (cfg & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD;
  const uninit = (st & STATUS_UNINITIALIZED) !== 0;
  const pending = (st & STATUS_PENDING) !== 0;
  const errored = isFn && (st & STATUS_ERROR) !== 0;
  const stagedError = (cfg & CONFIG_STAGED_ERROR) !== 0;
  /** The staging as a slot: its value, or the error it stages (D-41). */
  const stagedSlot = stagedError ? SLOT_ESTAGED : SLOT_P;
  /** The screen as a slot: the committed value, or the error still shown
   * there — a write or retry has not yet replaced it (D-41 `throwShown`,
   * #4110). */
  const screen = isFn && el._x?._shownError ? SLOT_ESHOWN : SLOT_C;
  /** f0: a flight with no value yet. */
  const firstFlight = pending && uninit;
  /** The pass is lane work, or a hold's verdict reader (`passLane` — the
   * lane engine's: without it no pass is seated, and the rows fold). */
  const inSeat = laneReadHook !== null && passLane !== null;
  const lane = inSeat ? laneOf(passLane) : null;
  const inLane = lane !== null;
  /** (The reader's own state matters to the seat and verdict rows alone.) */
  const cUninit =
    (inSeat || verdictApplyHook !== null) &&
    c !== null &&
    (c._statusFlags & STATUS_UNINITIALIZED) !== 0;
  /** D-41 (#2897): an errored derivation's retry — a tracked re-read on a
   * later cycle than the one that found the error re-runs it and reads
   * again. */
  const retry = errored && tracked && c !== null && (el as Computed<any>)._time < clock;
  /** A pending read thrown to an owned untracked reader still links it
   * (`read`'s throw arm; not `spectate`, not the node itself). */
  const nrLink = c !== null && !tracked && !spectate && el !== c ? MARK_LINK : 0;
  /** A28: a held node rewritten outside a flush serves the staging the
   * last flush left (`_flushed`) until the flush that carries the
   * rewrite. */
  const stash = held && unflushed(el) && el._x!._flushedAt === clock;
  /** A28: served the committed value — or the stash — over a write not yet
   * flushed: a late-linker re-run (`markLateLinker`). */
  const late = c !== null && (held ? stash : unflushed(el)) ? MARK_LATE : 0;

  // ── U: no pass ──────────────────────────────────────────────────────────
  if (posture === POSTURE_U) {
    if (firstFlight) return (ROW && setRow("U2"), SLOT_NR); // F-9: no value yet
    // D-41: an errored derivation, or a shown error a write/retry has not
    // yet replaced on the screen (`_shownError`), is the screen's answer.
    if (errored) return (ROW && setRow("U4"), SLOT_E);
    if (screen !== SLOT_C) return (ROW && setRow("U4"), screen);
    if (uninit && staged) return (ROW && setRow("U2"), SLOT_NR0); // D-24: born held, no screen
    return (ROW && setRow("U1"), SLOT_C); // D-29 D-34 F-10 (s unflushed: C)
  }

  // ── F: children-forbidden (the frame; A32) ─────────────────────────────
  if (posture === POSTURE_F) {
    ROW && setRow("F1");
    if (retry) return SLOT_RETRY;
    if (errored) return SLOT_E | (stagedError && !uninit ? late : 0);
    // (A first flight is `read`'s throw — it links; a node born staged has
    // nothing for the frame, A19 exc. 1 — no source.)
    if (firstFlight) return SLOT_NR | nrLink;
    if (uninit && staged) return SLOT_NR0;
    // D-29: the committed value (lane work's frame reader over a flight:
    // the screen, `throwShown`); over an unflushed write, the late re-run
    // (a held node's: its stash).
    if (pending && inSeat && !cUninit) return screen;
    if (stash) return SLOT_STASH | late;
    return SLOT_C | (staged ? late : 0);
  }

  // ── Common arms for L / D / V / A-as-D ─────────────────────────────────
  // (An authoritative reader of a lane's node took the lane rows — `until`
  // sees the truth, D-31; of any other node it reads as a derivation.)
  const leaf = posture === POSTURE_L;
  // (A truth reader that is also a verdict reader — F-6's flag copy, a
  // window of its own — reads a hold's node as a verdict reader does:
  // `truthRead` is for lane nodes only.)
  const verdictReader =
    verdictApplyHook !== null &&
    (posture === POSTURE_V || (posture === POSTURE_A && (c!._config & CONFIG_VERDICT) !== 0));
  const rowBase = ROW && (posture === POSTURE_A ? "A1/" : "");
  /** A verdict reader that is an effect (its pass re-derives once as a
   * verdict reader if the flush parks, D-22). */
  const vEffect = verdictReader && !!(c as any)._type;
  /** A staging served to the pass (`stagedRead`): the pass derives from
   * this flush (Fl) — and watches the seam when it is lane work, a hold's
   * verdict reader, or a verdict reader that is a leaf (an effect). Not a
   * node born staged (#3969: no screen to re-derive on). Over a write not
   * yet flushed, the committed value (or the stash) and a late re-run
   * instead (A28). */
  const stagedServe = late ? MARK_LATE : uninit ? 0 : RAISE_FL | (inSeat || vEffect ? MARK_W : 0);
  const latestOnly =
    verdictApplyHook !== null &&
    flushTransaction !== null &&
    flushTransaction === latestOpened &&
    !inSeat &&
    !cUninit;
  /** `stagedScreen`: a verdict reader's — or lane work's — plain read of a
   * staging is the screen's once the frame has a hold, unless born into it
   * — a stale reader of the hold. A hold a `latest()` alone opened holds
   * nothing: the reader watches the seam (W) and is served the staging. */
  const stagedScreen =
    (verdictReader || inLane) &&
    flushTransaction !== null &&
    !(c !== null && bornInto(c, flushTransaction));
  /** A verdict reader's staging read (`serve`'s verdict arm, then
   * `stagedRead`): the screen and ST, or — under `latest()`'s hold alone,
   * or with no hold — the staging, Fl, and W (for a `latest()`-only hold
   * the seam watch comes from `stagedScreen` whoever the reader is). */
  const verdictStaged = (slotOf: number): number => {
    if (stagedScreen && !latestOnly) {
      ROW && setRow("V2");
      seatTx = flushTransaction;
      return screen | MARK_ST;
    }
    ROW && setRow("V3");
    return slotOf | RAISE_FL | (latestOnly || inSeat || vEffect ? MARK_W : 0);
  };

  // Error (D-41 #2897): the error — the retry re-reads. The hold arms run
  // first (`read`'s L2 block): a derivation of a held errored node joins
  // before it throws. A staged error replacing the shown one
  // (`stageError`) is served as the staging would be: a reader served the
  // screen throws the shown error, one served the staging throws the
  // staged one and stages its own with it (Fl).
  if (errored) {
    let r = held ? heldRow(true) : SLOT_E;
    let s = retry ? SLOT_RETRY : SLOT_E;
    r &= ~(MARK_LINK | SLOT_MASK); // (the error is thrown, not NotReady)
    if (!retry && stagedError && !(r & MARK_ST)) {
      if (verdictReader && c!._config & CONFIG_VERDICT && !uninit && !late) {
        const v = verdictStaged(SLOT_ESTAGED);
        r |= v & RAISE_MASK;
        if ((v & SLOT_MASK) === SLOT_ESTAGED) s = SLOT_ESTAGED;
      } else {
        r |= stagedServe;
        if (!late && !uninit) s = SLOT_ESTAGED;
      }
    }
    ROW && setRow(leaf ? "L8" : rowBase + "D5");
    return r | s;
  }

  // Held node.
  if (held) return heldRow(false);

  /** The held rows. `err`: the node is errored — the slot is the error's
   * (the caller's), the marks the row's. */
  function heldRow(err: boolean): number {
    const t = txOf(el);
    seatTx = t;
    const own = t === flushTransaction || bornInto(c!, t);
    /** A row that joins and is served the staging (or NR in flight). */
    const join = (extra = 0): number =>
      pending
        ? SLOT_NR | RAISE_H | extra | nrLink
        : (staged ? (stash ? SLOT_STASH : stagedSlot) : SLOT_C) |
          RAISE_H |
          extra |
          (staged && !err ? stagedServe : 0);
    const stale = (served: boolean): number => screen | MARK_ST | (served ? MARK_SERVED : 0);
    if (leaf) {
      // L4 (D-9 D-2 D-27): inputs published, or born — the leaf has no
      // screen to fall back to; it joins the hold (D-4): its world is the
      // hold's and its children inherit it (INV-seat-1 as amended).
      // (A staged error throws, D-41 — the 50k differential's L4 finding.)
      if (uninit) return (ROW && setRow("L4"), join(MARK_TICK));
      if (cfg & CONFIG_INPUTS_PUBLISHED) return (ROW && setRow("L4"), join());
      if (bornInto(c!, t)) return (ROW && setRow("L2"), join()); // D-2
      if (inSeat) return (ROW && setRow("D6"), stale(true)); // lane work: the screen (D-37)
      if (own) return (ROW && setRow("L2"), join()); // D-3 D-2
      return (ROW && setRow("L3"), stale(false)); // D-3 D-9 D-26
    }
    if (verdictReader) {
      // V1 (D-23 A10 [R7]): a verdict reader is a frame reader — the
      // screen, re-derived at the landing — unless born into t.
      if (bornInto(c!, t)) return (ROW && setRow("V1'"), join());
      if (uninit) return (ROW && setRow("V1''"), join()); // no screen to serve
      return (ROW && setRow("V1"), stale(true));
    }
    if (inSeat) {
      // D6 (D-37): lane work reading a hold's node — the screen, re-derived
      // at that landing; a lane pass with no value yet over a flight enters.
      if (!(cUninit && pending) && !uninit && !bornInto(c!, t))
        return (ROW && setRow(rowBase + "D6"), stale(true));
      return (ROW && setRow(rowBase + "D6'"), join());
    }
    // D2 (D-1 D-2 D-10): the pass derives from the hold.
    return (ROW && setRow(rowBase + (pending ? "D2'" : "D2")), join());
  }

  // Staged this flush, not held.
  if (staged) {
    if (late && !uninit) {
      // A28 / F-10: an unflushed write — the committed value now and a late
      // re-run in the flush that carries it (`markLateLinker`).
      return (ROW && setRow(leaf ? "L1'" : rowBase + "D1'"), SLOT_C | MARK_LATE);
    }
    if (uninit && !pending && spectate) return (ROW && setRow("U2"), SLOT_NR0);
    // (F-9, as D1/L1: a staging beneath a flight is not what the reader
    // sees — the flight decides below. The 50k differential's V3 finding.)
    if (!pending) {
      // V2/V3 (D-23 D-32 [R5]): the screen once the tick has a hold, the
      // staging before (the seam's verdict).
      if (verdictReader && !uninit && c!._config & CONFIG_VERDICT) return verdictStaged(stagedSlot);
      if (inLane && lane!.folded && stagedScreen && !uninit) {
        // Folded lane work reads the screen (D-34).
        ROW && setRow(rowBase + "D7'");
        seatTx = flushTransaction;
        return SLOT_C | MARK_ST;
      }
      // (D-28's leaf treatment of a lane — lanes.ts L6/L7 — is a render
      // effect's, the binding that shows: L1. A boundary's structure
      // (CONFIG_FRAME, posture L per #4283) reads as a derivation does.)
      ROW &&
        setRow(
          (c as any)._type === EFFECT_RENDER && (leaf || verdictReader)
            ? "L1"
            : inLane
              ? rowBase + "D7"
              : rowBase + "D1"
        );
      return stagedSlot | stagedServe;
    }
  }

  // A flight, not held.
  if (pending) {
    // D-37: not the lane's own, the pass has a value — and so does the
    // node (a first load in flight has no screen: NR, F-2).
    if (inSeat && !cUninit && !uninit) return (ROW && setRow(rowBase + "D8"), screen);
    if (verdictReader && !uninit) {
      if (cfg & CONFIG_INPUTS_PUBLISHED) {
        ROW && setRow("V4'");
        seatTx = flushTransaction;
        return SLOT_NR | nrLink;
      }
      // D-23 D-9: the screen; in a flush the pass is the hold's verdict
      // reader and a stale reader of the flight (`observeFlight`: the
      // flush's hold opens if none has, and the flight nobody holds is
      // queued for the seam).
      ROW && setRow("V4");
      if (globalQueue._running) {
        seatTx = flushTransaction;
        return screen | MARK_ST | MARK_AH | MARK_JF0 | MARK_OBS;
      }
      return screen;
    }
    return (ROW && setRow(leaf ? "L5" : rowBase + "D3"), SLOT_NR | nrLink); // F-2 D-28 / F-2 D-9
  }

  return (ROW && setRow(leaf ? "L0" : rowBase + "D0"), SLOT_C); // committed only
}

// ─── The shadow seat (module state the swap's M3 makes the seat) ──────────

export interface Prediction {
  row: string;
  slot: number;
  raise: number;
  /** The hold the side effects name (ST(t), AH(t)). */
  tx: Transaction | null;
  /** The lane a RAISE_LANE moves the pass into. */
  lane: Transaction | null;
}

export interface Seat {
  node: Computed<any> | null;
  create: boolean;
  /** The world this pass reads from: its own reads' (`ownWorld`), the hold
   * it was born into (`bornTx`), or its creator's own at birth. */
  world: number;
  /** The world this pass's OWN reads raised it to (today: the pass's
   * JOINED / STAGED_READ flags). What a child inherits at birth is this —
   * one level (today `creatorPass(oldcontext)._flags & JOINED`), so a
   * grandchild of a joined pass that read only committed values publishes
   * directly (F-transitive, design doc §7). */
  ownWorld: number;
  lane: Transaction | null;
  /** The hold whose verdict reader this pass sits as (today: `passLane` is
   * that hold's verdict lane). Set by a verdict read of the hold's node
   * (`route`), by a pass whose staging sits in the verdict lane, or by a
   * boundary's display-ahead swap; cleared by a lane read (the pass is the
   * lane's) and by D-28's leave. Verdict lanes have no node set at the swap:
   * this is the seat's memory of "which hold's verdict reader". */
  vhold: Transaction | null;
  ahead: boolean;
  posture: number;
  /** The hold this pass was born into (`bornInto`): held, uninitialized or
   * a held frame member. Its world is that hold's (H) from the start. */
  bornTx: Transaction | null;
  /** The creator is display-ahead itself (in a lane, or seated as a hold's
   * verdict reader), not merely under a display-ahead mount: B2's
   * nested-derivation exclusion (#4203, #4340) is for the latter. */
  creatorDirect: boolean;
  creatorRunning: boolean;
  /** The world the running creators read (today `creatorReads`: JOINED |
   * STAGED_READ up the running chain, transitive): a pass created under a
   * branch that read the future or a staging has no screen — when it asks
   * (`latest`/`isPending`) it is not a verdict reader but takes that world
   * (#4341), and a verdict lane's value does not break it out
   * (`enterLane`). */
  creatorsWorld: number;
  /** The running creator's own world at birth (today
   * `creatorPass(oldcontext)._flags & JOINED`): B2 inherits it one level. */
  creatorWorld: number;
  /** A leaf's first pass read the hold's staging (L2/L4): its first run is
   * the hold's — born held without its world moving (design doc §6, B2). */
  bornLeaf: boolean;
  /** A leaf read a staging of the flush (L1, MARK_SR). */
  sawStaging: boolean;
  /** The rows this pass hit, for the report. */
  trail: string[];
  /** A known difference (filed) happened in this pass: the old seat and
   * the new have parted by construction; the pass's end is not compared. */
  known: boolean;
}

const seats: Seat[] = [];
let depth = -1;

/** The seat of the running pass, or null outside every pass. */
export function currentSeat(): Seat | null {
  return depth >= 0 ? seats[depth] : null;
}

/** B1 — open the seat of a pass at `recompute`'s head. The creator of a
 * first pass is the RUNNING pass — the top of the seat stack (F-mount,
 * design doc §7: a `runWithOwner` into another owner still creates under
 * the pass that runs). `ownLane` is the node's own lane (LANE_DIRTY, or
 * OVERRIDE without GUESS, on a lane's transaction — a verdict lane's
 * included), decided by the caller from the node. */
export function openSeat(
  el: Computed<any>,
  create: boolean,
  creator: Computed<any> | null,
  ownLane: Transaction | null
): Seat {
  const parent: Seat | null = create && depth >= 0 ? seats[depth] : null;
  const creatorRunning = parent !== null;
  // The owner's computed is a running pass (today's test for inheriting
  // the lane: `creatorPass(context)._flags & RECOMPUTING_DEPS`). A
  // `runWithOwner` into an owner that is not running — `fallback`'s `b._fb`
  // memo, created beside the output in its owner — is not lane work by
  // birth: "the swap is structure" (#3540); it enters a lane by reading.
  let ownerRunning = false;
  if (create && creator !== null)
    for (let i = depth; i >= 0; i--)
      if (seats[i].node === creator) {
        ownerRunning = true;
        break;
      }
  const bornTx =
    el._config & CONFIG_HELD &&
    (el._statusFlags & STATUS_UNINITIALIZED || el._config & CONFIG_HELD_FRAME)
      ? txOf(el)
      : null;
  let world = WORLD_S;
  let lane: Transaction | null = null;
  let vhold: Transaction | null = null;
  let ahead = false;
  let creatorDirect = false;
  let creatorsWorld = WORLD_S;
  let creatorWorld = WORLD_S;
  if (bornTx !== null) world = WORLD_H;
  if (creatorRunning) {
    // First pass: {world, lane, ahead} from the running creator pass — the
    // world it raised itself to (one level), its lane, its ahead-ness.
    const p = parent!;
    // One level (D-27's letter: "a node it creates during that pass"; today's
    // `creatorPass(oldcontext)` JOINED): the creator's own reads, not the
    // world it inherited or was born into. F-transitive, settled 2026-10-29
    // by the differential: the transitive reading (`p.world`) makes a
    // mapArray row root under a joined pass, and a born-into effect's
    // child, born held where today they publish (signals ×14, S0's ×301 at
    // 2k); this reading differs from today only where today reads an owner's
    // STALE flag — `fallback`'s `b._fb` created under `out._parent` while a
    // pulled, held output runs (generator ×31 at 2k × 3; no suite shape),
    // the F-mount reading-A residue by definition.
    creatorWorld = p.ownWorld;
    if (creatorWorld > world) world = creatorWorld;
    // Display-ahead: the creator is in a lane or seated as a hold's verdict
    // reader (today `prevLane`), or under a mount that was (`laneRoot`).
    creatorDirect = p.lane !== null || p.vhold !== null;
    ahead = p.ahead || creatorDirect;
    // The branch this pass exists in (#4341, D-26): its owners' passes while
    // they run — a node a running pass created, and that pass's own
    // creators. Not the pass that merely pulls a lazy memo another owner
    // made: the memo's branch is its owner's, and its first pass reads the
    // screen where the puller read a staging (today `creatorReads` walks
    // `_parent`, the owner chain, stopping at the first owner not running).
    for (let o = el._parent; o !== null; ) {
      const cp: Computed<any> | null = (o as any)._root
        ? ((o as any)._parentComputed ?? null)
        : (o as Computed<any>);
      if (cp === null) break;
      let s: Seat | null = null;
      for (let i = depth; i >= 0; i--)
        if (seats[i].node === cp) {
          s = seats[i];
          break;
        }
      if (s === null) break;
      if (s.ownWorld > creatorsWorld) creatorsWorld = s.ownWorld;
      o = cp._parent;
    }
    // The creator's lane is inherited (its owner running); a verdict seat
    // is not — a verdict reader's mount is a mainline mount (D-27, #3851).
    if (ownerRunning) lane = p.lane;
  }
  if (ownLane !== null) {
    // A node whose staging sits in a hold's verdict lane re-passes as that
    // hold's verdict reader (F-vlane, ruled 2026-10-28: the posture is the
    // rule, today's membership the mechanism that carries it).
    if (laneOf(ownLane) === null) {
      vhold = resolveTx(ownLane._parent!);
      lane = null;
    } else lane = ownLane;
  }
  const seat: Seat = {
    node: el,
    create,
    world,
    ownWorld: WORLD_S,
    lane,
    vhold,
    ahead,
    posture: POSTURE_U,
    bornTx,
    creatorDirect,
    creatorRunning,
    creatorsWorld,
    creatorWorld,
    bornLeaf: false,
    sawStaging: false,
    trail: [],
    known: false
  };
  seats[++depth] = seat;
  seat.posture = postureOf(el, 0);
  return seat;
}

/** Today's `passLane !== null`: the pass is a lane's work or a hold's
 * verdict reader. */
function seated(seat: Seat | null): boolean {
  return seat !== null && (seat.lane !== null || seat.vhold !== null);
}

/** B2 — the born-held decision at a first pass's end: the tick has a hold
 * and the pass derived from it (world H — its own reads', or inherited
 * from its creator's own, one level), or it is a display-ahead mount's
 * first pass that read a staging (ahead, world ≥ Fl) — unless a nested
 * derivation left pending (#4203, #4340): no render effect reaches it yet. */
export function bornHeld(seat: Seat, isEffect: boolean, pending: boolean): boolean {
  if (!seat.create) return false;
  if (flushTransaction === null && passTx === null) return false;
  if (seat.ahead && !seat.creatorDirect && !isEffect && pending)
    return seat.creatorWorld === WORLD_H;
  return (
    seat.world === WORLD_H ||
    seat.bornLeaf ||
    (seat.ahead && (seat.ownWorld >= WORLD_FL || seat.sawStaging))
  );
}

/** Close the seat opened by `openSeat`. */
export function closeSeat(seat: Seat): void {
  if (depth < 0 || seats[depth] !== seat) {
    report("INV-seat", "B1", seat.node, null, "seat stack out of order", 0, 0);
    return;
  }
  seats[depth--] = undefined as any;
}

/** A row's raise applied to the reader's seat (D-1: only up). A lane read
 * moves the pass into the lane — the nested one of the two when one sits
 * under the other, else the two link (D4, [R4]) and the pass sits in the
 * one just read. */
function applyRaise(seat: Seat, p: Prediction): void {
  seat.trail.push(p.row);
  if (p.raise & MARK_HOLD && seat.create) seat.bornLeaf = true;
  if (p.raise & MARK_SR) seat.sawStaging = true;
  // D-28: the leaf leaves the verdict seat before the read is served.
  if (p.raise & MARK_LEAVE) seat.vhold = null;
  if (p.raise & RAISE_H && seat.ownWorld < WORLD_H) seat.ownWorld = WORLD_H;
  if (p.raise & RAISE_FL && seat.ownWorld < WORLD_FL) seat.ownWorld = WORLD_FL;
  if (seat.ownWorld > seat.world) seat.world = seat.ownWorld;
  // Display-ahead (today `route`): the pass is the hold's verdict reader
  // unless already seated, or already the frame's (it read the future or a
  // staging: world > S).
  if (p.raise & MARK_AH && p.tx !== null && !seated(seat) && seat.ownWorld === WORLD_S)
    seat.vhold = resolveTx(p.tx);
  if (p.raise & RAISE_VSEAT && p.lane !== null) {
    // (A lane the pass sat in links to the verdict lane, `laneApply`.)
    seat.vhold = resolveTx(p.lane._parent!);
    seat.lane = null;
  }
  if (p.raise & RAISE_LANE && laneOf(p.lane) !== null) {
    const l = p.lane!;
    const s = seat.lane;
    if (s === null || sameLane(s, l) || !under(s, l)) seat.lane = l;
    // The pass is the lane's now (a verdict seat it held links to the
    // lane, `enterLane`).
    seat.vhold = null;
  }
}

/** Is `l` nested under `a`? */
function under(l: Transaction, a: Transaction): boolean {
  for (let t = l._parent; t !== null && t._lane; t = t._parent) if (t === a) return true;
  return false;
}

// ─── Shadow harness ────────────────────────────────────────────────────────

export interface ShadowMismatch {
  kind: string;
  row: string;
  node: string;
  reader: string;
  expected: string;
  actual: string;
  count: number;
  detail: string;
  /** The generator case first seen in (`__SEAT_SHADOW_CASE__`), for a replay. */
  case: string | null;
}

const mismatches = new Map<string, ShadowMismatch>();
const rowHits = new Map<string, number>();
let reads = 0;
let passes = 0;
let orphanReads = 0;

/** Set by a test setup (or `globalThis.__SEAT_SHADOW__`) to throw on the
 * first disagreement instead of recording it. */
function strict(): boolean {
  return !!(globalThis as any).__SEAT_SHADOW_STRICT__;
}

function nameOf(n: AnyNode | null | undefined): string {
  if (!n) return "—";
  const name = (n as any)._name;
  const kind =
    typeof (n as Computed<any>)._fn === "function"
      ? (n as any)._type
        ? "effect"
        : "memo"
      : "signal";
  return `${kind}${name ? `:${name}` : ""}#${(n as any).id ?? "?"}`;
}

/** The node-state bits of the table, for a mismatch message. */
function stateOf(c: Computed<any> | null, el: AnyNode | null): string {
  if (el === null) return "";
  const st = ((el as Computed<any>)._statusFlags as number | undefined) ?? 0;
  const cfg = el._config;
  const bits: string[] = [];
  if (el._pendingValue !== NOT_PENDING) bits.push("s");
  if (cfg & CONFIG_HELD) bits.push("h");
  if (st & STATUS_UNINITIALIZED) bits.push("u");
  if (st & STATUS_PENDING) bits.push("f");
  if (st & STATUS_ERROR) bits.push("e");
  if (cfg & CONFIG_OVERRIDE) bits.push(cfg & CONFIG_GUESS ? "g" : "d");
  if (cfg & CONFIG_INPUTS_PUBLISHED) bits.push("ip");
  if (cfg & CONFIG_OVERRIDE || cfg & CONFIG_HELD) {
    const t = el._x?._transaction;
    if (t) {
      if (t._lane) {
        bits.push(laneOf(t) === null ? "vlane" : "lane");
        if (t._parent !== null && resolveTx(t._parent) !== t._parent) bits.push("parentMerged");
      } else if (resolveTx(t) !== t) bits.push("txMerged");
      if (t._shown) bits.push("shown");
      if (t._held) bits.push("lheld");
      if (t.folded) bits.push("folded");
    }
  }
  const seat = currentSeat();
  const cbits: string[] = [];
  if (c !== null && c._statusFlags & STATUS_UNINITIALIZED) cbits.push("cU");
  if (c !== null && c._config & CONFIG_HELD) {
    cbits.push(c._config & CONFIG_HELD_FRAME ? "cHF" : "cH");
    const ct = c._x?._transaction,
      et = el._x?._transaction;
    if (ct && et) cbits.push(resolveTx(ct) === resolveTx(et) ? "cSameTx" : "cOtherTx");
  }
  if (c !== null && (c as any)._type) cbits.push(`t${(c as any)._type}`);
  if (seat !== null && seat.node === c) {
    cbits.push(`w${seat.world}`);
    if (seat.lane !== null) cbits.push("inLane");
    if (seat.vhold !== null) cbits.push("vseat");
    if (seat.ahead) cbits.push("ahead");
  }
  cbits.push(laneOf(passLane) !== null ? "oldLane" : passLane !== null ? "oldVlane" : "oldNoLane");
  if (flushTransaction !== null) {
    cbits.push(resolveTx(flushTransaction) === flushTransaction ? "flushTx" : "flushTxMerged");
    const et = el._x?._transaction;
    if (et)
      cbits.push(resolveTx(flushTransaction) === resolveTx(et) ? "flushIsElTx" : "flushNotElTx");
  } else if (passTx !== null) cbits.push("passTx");
  return `${bits.join(" ")} · ${cbits.join(" ")}`;
}

function report(
  kind: string,
  row: string,
  reader: AnyNode | null,
  node: AnyNode | null,
  detail: string,
  expected: number,
  actual: number
): void {
  const key = `${kind}|${row}|${SLOT_NAMES[expected] ?? expected}|${SLOT_NAMES[actual] ?? actual}|${detail}`;
  let m = mismatches.get(key);
  if (!m) {
    m = {
      kind,
      row,
      node: nameOf(node),
      reader: nameOf(reader),
      expected: SLOT_NAMES[expected] ?? String(expected),
      actual: SLOT_NAMES[actual] ?? String(actual),
      count: 0,
      detail,
      // The generator case running (campaign / regression spec), for a replay.
      case: (globalThis as any).__SEAT_SHADOW_CASE__ ?? null
    };
    mismatches.set(key, m);
  }
  m.count++;
  const trace = (globalThis as any).__SEAT_SHADOW_TRACE__;
  if (trace && m.count <= 3 && (key.includes(trace) || row === trace))
    (globalThis as any).process?.stderr?.write(
      `[seat-shadow] ${key} reader ${m.reader} node ${m.node} trail ${currentSeat()?.trail.join(",")} seat ${currentSeat() ? `w${currentSeat()!.world}/${currentSeat()!.ownWorld} lane ${!!currentSeat()!.lane} vhold ${!!currentSeat()!.vhold} ahead ${currentSeat()!.ahead}` : "—"} parent ${depth > 0 ? `${nameOf(seats[depth - 1].node)} w${seats[depth - 1].world}/${seats[depth - 1].ownWorld} flags ${seats[depth - 1].node!._flags.toString(2)} trail ${seats[depth - 1].trail.join(",")}` : "-"} cfg ${reader ? reader._config.toString(2) : "-"} elcfg ${node ? node._config.toString(2) : "-"} elflags ${(node as any)?._flags?.toString(2) ?? "-"}\n` +
        new Error().stack +
        (actual === SLOT_NR || actual === SLOT_E
          ? "\n  thrown: " +
            String((lastThrown as any)?.stack ?? lastThrown)
              .split("\n")
              .slice(0, 6)
              .join("\n  ")
          : "") +
        "\n"
    );
  if (strict())
    throw new Error(
      `[INVARIANT_VIOLATION] ${kind}: row ${row} — ${detail}; expected ${m.expected}, got ${m.actual}; reader ${m.reader} node ${m.node}`
    );
}

/** The shadow's record, for a reporter (`tests/seat-shadow-report.ts`,
 * the generator's campaign) and `globalThis.__SEAT_SHADOW__`. */
export function shadowReport(): {
  reads: number;
  passes: number;
  orphanReads: number;
  rows: Record<string, number>;
  mismatches: ShadowMismatch[];
  /** Known differences hit, by issue number (`shadowKnown`). */
  known: Record<string, number>;
} {
  return {
    reads,
    passes,
    orphanReads,
    rows: Object.fromEntries(rowHits),
    mismatches: [...mismatches.values()],
    known: Object.fromEntries([...knownHits].map(([k, v]) => [String(k), v]))
  };
}
export function shadowReset(): void {
  mismatches.clear();
  rowHits.clear();
  knownHits.clear();
  reads = passes = orphanReads = 0;
}

// Per-read frames: the decision point stores the table's prediction (after
// comparing it with the oracle's); the return site stores the slot served.
interface ReadFrame {
  c: Computed<any> | null;
  el: AnyNode | null;
  prediction: Prediction | null;
  posture: number;
  actual: number;
}
const frames: ReadFrame[] = [];
let readDepth = -1;
/** True while the body of `read` runs for the frame on top (consumed by the
 * re-entry; nested reads are shadowed on their own). */
export let shadowBypass = false;

export function shadowEnter(): void {
  const f = (frames[++readDepth] ??= {
    c: null,
    el: null,
    prediction: null,
    posture: POSTURE_U,
    actual: SLOT_NONE
  });
  f.c = f.el = null;
  f.prediction = null;
  f.actual = SLOT_NONE;
  shadowBypass = true;
}
export function shadowConsumeBypass(): boolean {
  if (shadowBypass) {
    shadowBypass = false;
    return true;
  }
  return false;
}

/** A slot as the brief's vocabulary names it: the serving variants fold. */
function plainSlot(s: number, el: AnyNode | null): number {
  switch (s) {
    case SLOT_ESTAGED:
    case SLOT_ESHOWN:
      return SLOT_E;
    case SLOT_NR0:
      return SLOT_NR;
    case SLOT_STASH:
      return SLOT_P;
    case SLOT_FOLD:
      return el !== null && el._pendingValue !== NOT_PENDING ? SLOT_P : SLOT_C;
    case SLOT_RETRY:
      return SLOT_SNAPSHOT;
  }
  return s;
}

/** The decision point of `read`/`verdictValue`: the table has decided
 * (`r`, with `seatTx`/`seatLane`/`seatRow`). The oracle — the old
 * deciders as a pure function — decides beside it, and the two are
 * compared: slot, raise bits, the holds they name, the lane. The
 * prediction is kept for the frame's close (the world and seat after). */
export function shadowDecided(
  c: Computed<any> | null,
  el: AnyNode,
  tracked: boolean,
  window: number,
  spectate: boolean,
  r: number
): void {
  if (readDepth < 0) return;
  const f = frames[readDepth];
  const p: Prediction = {
    row: String(seatRow),
    slot: r & SLOT_MASK,
    raise: r & RAISE_MASK,
    tx: seatTx,
    lane: seatLane
  };
  f.c = c;
  f.el = el;
  f.posture = postureOf(c, window);
  f.prediction = p;
  const o = oldSlot(c, el, tracked, window, spectate);
  const seat = currentSeat();
  const ps = plainSlot(p.slot, el);
  const os = plainSlot(o.slot, el);
  // The identity of a serving variant is compared too (which error, the
  // stash): the table's vocabulary is finer than the brief's.
  if (p.slot !== o.slot) {
    if (shadowKnown("slot", p.row, ps, os, c, el, seat)) {
      if (seat !== null) seat.known = true;
      return;
    }
    report(
      "INV-seat-3",
      p.row,
      c,
      el,
      `slot (${POSTURE_NAMES[f.posture]} posture; ${stateOf(c, el)}${ps === os ? `; variant ${SLOT_NAMES[p.slot]}#${p.slot} vs ${SLOT_NAMES[o.slot]}#${o.slot}` : ""})`,
      ps,
      os
    );
    return;
  }
  const diff = (p.raise ^ o.raise) & COMPARED;
  if (diff) {
    const worldOnly = !(diff & ~(RAISE_H | RAISE_FL));
    const oldWorld = o.raise & RAISE_H ? WORLD_H : o.raise & RAISE_FL ? WORLD_FL : WORLD_S;
    const newWorld = p.raise & RAISE_H ? WORLD_H : p.raise & RAISE_FL ? WORLD_FL : WORLD_S;
    if (
      (worldOnly &&
        seat !== null &&
        shadowKnown("world", p.row, newWorld, oldWorld, c, el, seat)) ||
      shadowKnown("marks", p.row, p.raise & COMPARED, o.raise & COMPARED, c, el, seat)
    ) {
      if (seat !== null) seat.known = true;
      return;
    }
    report(
      "INV-seat-4",
      p.row,
      c,
      el,
      `marks (table ${raiseNames(p.raise & COMPARED)}, oracle ${raiseNames(o.raise & COMPARED)}; ${POSTURE_NAMES[f.posture]} posture; ${stateOf(c, el)})`,
      ps,
      os
    );
    return;
  }
  // (A row that opens the flush's transaction names the one it will open:
  // both say null before the read.)
  if (p.raise & (MARK_ST | MARK_AH | RAISE_HAT) && p.tx !== o.tx)
    report("INV-seat-4", p.row, c, el, `the hold named (${stateOf(c, el)})`, ps, os);
  if (p.raise & (MARK_LST | RAISE_LANE | RAISE_VSEAT) && p.lane !== o.lane)
    report("INV-seat-4", p.row, c, el, `the lane named (${stateOf(c, el)})`, ps, os);
}

/** `read`'s fast path (core.ts): a node it serves `_value` with no world
 * to choose. The table and the oracle both say C with no mechanism, or the
 * fast path's condition is wrong. */
export function shadowFast(
  c: Computed<any> | null,
  el: AnyNode,
  tracked: boolean,
  spectate: boolean
): void {
  if (readDepth < 0) return;
  reads++;
  rowHits.set("fast", (rowHits.get("fast") ?? 0) + 1);
  const r = slot(c, el, tracked, spectate);
  const o = oldSlot(c, el, tracked, 0, spectate);
  if (r !== SLOT_C || o.slot !== SLOT_C || o.raise !== 0)
    report(
      "INV-seat-3",
      "fast",
      c,
      el,
      `fast path (table ${String(seatRow)} ${SLOT_NAMES[r & SLOT_MASK]}+${raiseNames(r & RAISE_MASK)}, oracle ${SLOT_NAMES[o.slot]}+${raiseNames(o.raise)}; ${stateOf(c, el)})`,
      r & SLOT_MASK,
      o.slot
    );
}

/** A raise issued outside `read` — the store's read path calls the kept
 * shims (`stagedRead`, `joinPass`, `joinPassAt`) directly (design doc §1.2).
 * Applied to the shadow seat when no read frame of `c` is open, so the
 * world comparison does not blame a row for the store's join. */
export function shadowExternalRaise(
  c: Computed<any>,
  raise: number,
  lane: Transaction | null = null,
  tx: Transaction | null = null
): void {
  if (readDepth >= 0 && frames[readDepth].c === c) return;
  const seat = currentSeat();
  if (seat === null || seat.node !== c) return;
  applyRaise(seat, { row: "ext", slot: raise, raise, tx, lane });
  seat.trail.pop();
}

/** The pass entered a verdict window (`markVerdictReader`): a verdict reader
 * from here (CONFIG_VERDICT, set by the caller) — unless its running
 * creators read the future or a staging (#4341): then it is in their world
 * and stays the frame's pass (today: their JOINED | STAGED_READ bits are
 * copied onto it). */
export function shadowWindow(c: Computed<any>): void {
  const seat = currentSeat();
  if (seat === null || seat.node !== c) return;
  if (seat.creatorsWorld > seat.ownWorld) {
    seat.ownWorld = seat.creatorsWorld;
    seat.trail.push(`win${seat.creatorsWorld}:${nameOf(depth > 0 ? seats[depth - 1].node : null)}`);
  }
  if (seat.ownWorld > seat.world) seat.world = seat.ownWorld;
}

/** A boundary's display-ahead swap (`fallback`, #3540 #4337): the output's
 * pass is seated where the re-arm's `on` pass was — a lane's work, or a
 * verdict reader's (the `isPending`/`latest` the `on` read). */
export function shadowSwapSeat(out: Computed<any>, l: Transaction): void {
  shadowExternalRaise(out, laneOf(l) === null ? RAISE_VSEAT : RAISE_LANE, l);
}

/** The swap is structure (#3540, #4337): what the fallback's build reads
 * ahead — a verdict (`latest()`), a lane — is the fallback's display-ahead,
 * not the output's. The output's seat around `fallback`'s `read(b._fb)`:
 * saved before, restored after (today: `passLane` and the PROBED /
 * LANE_READ flags, bracketed). */
export function shadowSeatSave(
  out: Computed<any>
): [Transaction | null, Transaction | null] | null {
  const seat = currentSeat();
  if (seat === null || seat.node !== out) return null;
  return [seat.lane, seat.vhold];
}
export function shadowSeatRestore(
  out: Computed<any>,
  saved: [Transaction | null, Transaction | null] | null
): void {
  if (saved === null) return;
  const seat = currentSeat();
  if (seat === null || seat.node !== out) return;
  seat.lane = saved[0];
  seat.vhold = saved[1];
}

/** A return site of `read`: the slot it served (the applier's, against the
 * table's). */
export function shadowActual(s: number): void {
  if (readDepth >= 0) frames[readDepth].actual = s;
}

/** Trace aid: the last error a shadowed read threw. */
export let lastThrown: unknown = null;
export function shadowThrown(e: unknown): void {
  lastThrown = e;
}

/** Known differences — today's deciders wrong by rule, filed, and fixed by
 * the swap by construction (design doc §4.1): each entry names the issue and
 * the exact shape, so the differential stays zero elsewhere. A read that
 * matches is counted under `known #<issue>` instead of a mismatch class;
 * once the swap lands the entry's issue closes and the entry goes. */
interface KnownDifference {
  issue: number;
  /** What differs: the slot a read is served, the world a read leaves the
   * pass in, the mechanisms a read fires, or the born-held decision at the
   * pass's close. */
  kind: "slot" | "world" | "marks" | "born";
  /** The row (a read's) or "B2" (the close's). */
  row: string;
  /** The table's answer and today's (a slot, a world, the compared raise
   * bits, or 1/0 for born). */
  expected: number;
  actual: number;
  when: (c: Computed<any>, el: AnyNode | null, seat: Seat | null) => boolean;
}
const known: KnownDifference[] = [
  {
    // frameRead's `bornInto(c, txOf(el))` joins the pass, stagedScreen's
    // `bornInto(c, flushTransaction)` then serves the screen: a verdict
    // reader born into T run by another transaction's flush.
    issue: 4426,
    kind: "slot",
    row: "V1'",
    expected: SLOT_P,
    actual: SLOT_C,
    when: (c, el) =>
      (c._config & CONFIG_VERDICT) !== 0 &&
      flushTransaction !== null &&
      !!bornInto(c, txOf(el!)) &&
      resolveTx(flushTransaction) !== resolveTx(txOf(el!))
  },
  {
    // laneRead's D-28 reset compares verdict lanes by identity: a lane whose
    // parent merged into the seat's hold reads as another hold's.
    issue: 4427,
    kind: "slot",
    row: "V6",
    expected: SLOT_LV,
    actual: SLOT_P,
    when: (c, el) => {
      const l = el!._x?._transaction;
      const vhold = readerVhold();
      return (
        (c as any)._type === EFFECT_RENDER &&
        vhold !== null &&
        !!l &&
        l._lane &&
        laneOf(l) === null &&
        l._parent !== null &&
        resolveTx(l._parent) !== l._parent &&
        resolveTx(l._parent) === vhold
      );
    }
  },
  {
    // The same identity compare, where the slot agrees: the leaf leaves the
    // verdict seat and re-enters it from the lane read (`enterLane`) — one
    // seat move the table does not make.
    issue: 4427,
    kind: "marks",
    row: "V6",
    expected: MARK_LANE_READ,
    actual: MARK_LEAVE | MARK_LANE_READ,
    when: (c, el, seat) => known[1].when(c, el, seat)
  },
  {
    // The same, where the read is served the hold's own staging (L7', the
    // leaf is the flush's hold's): the leave alone.
    issue: 4427,
    kind: "marks",
    row: "V6",
    expected: 0,
    actual: MARK_LEAVE,
    when: (c, el, seat) => known[1].when(c, el, seat)
  },
  {
    // `recompute`'s born-held test reads `creatorPass(oldcontext)`'s JOINED
    // flag — the owner context of the creation, not the running pass. Under
    // `runWithOwner` to an ancestor (`fallback`'s `b._fb`, created in
    // `out._parent` while the output runs) that is a running ancestor that
    // read the future itself, while the running pass (the output) did not:
    // born held today, one level up the OWNER chain; not by the table's
    // one-level running creator (F-mount reading A). The transitive reading
    // (A29 / #4341: the branch exists only in the hold) agrees with today
    // here and disagrees in 14 suite passes — design doc §7 F-transitive,
    // pending the maintainer's ruling.
    issue: 4428,
    kind: "born",
    row: "B2",
    expected: 0,
    actual: 1,
    when: (c, _el, seat) => {
      const o = shadowOldCreator;
      return (
        o !== null &&
        seat !== null &&
        (o._flags & REACTIVE_JOINED) !== 0 &&
        (depth === 0 || seats[depth - 1].node !== o) &&
        !(c._flags & REACTIVE_JOINED) &&
        seat.creatorWorld < WORLD_H &&
        seat.creatorsWorld === WORLD_H
      );
    }
  },
  {
    // `isPending`'s `probing` flag is left set around a memo's pass the
    // probe pulled (`verdictValue` closes only the dispatch, A31): a
    // `latest()` of a born-into-the-future node inside that pass takes the
    // probe's `joinPass` arm and the pulled pass joins the hold. A verdict
    // read raises no world (F-vworld); the slot — the staging — agrees.
    // (The table's Vl4 joins for no probe, stale or live: `latest` inside
    // `isPending` of such a node — a shape no corpus has produced — reads
    // as `latest` does.)
    issue: 4429,
    kind: "world",
    row: "Vl4",
    expected: WORLD_S,
    actual: WORLD_H,
    when: (_c, el) =>
      (el!._config & CONFIG_HELD) !== 0 &&
      ((el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED) !== 0 &&
      el!._pendingValue !== NOT_PENDING &&
      !((el as Computed<any>)._statusFlags & STATUS_PENDING)
  }
];
const knownHits = new Map<number, number>();
export function shadowKnownHits(): ReadonlyMap<number, number> {
  return knownHits;
}
/** The old born-held test's creator (`creatorPass(oldcontext)`), for the
 * close's known entries. */
let shadowOldCreator: Computed<any> | null = null;
function shadowKnown(
  kind: KnownDifference["kind"],
  row: string,
  expected: number,
  actual: number,
  c: Computed<any> | null,
  el: AnyNode | null,
  seat: Seat | null
): boolean {
  if (c === null) return false;
  if (seat !== null && seat.node !== c) seat = null;
  for (const k of known)
    if (
      k.kind === kind &&
      k.row === row &&
      k.expected === expected &&
      k.actual === actual &&
      k.when(c, el, seat)
    ) {
      knownHits.set(k.issue, (knownHits.get(k.issue) ?? 0) + 1);
      return true;
    }
  return false;
}

/** The body returned (or threw: `thrown` is the slot of the throw). The
 * applier served the table's slot; the table's raise is applied to the
 * shadow seat and the pass's world and seat after the read compared with
 * the old state the mechanisms left. */
export function shadowLeave(thrown: number): void {
  if (readDepth < 0) return;
  const f = frames[readDepth--];
  shadowBypass = false;
  const p = f.prediction;
  const c = f.c;
  const el = f.el;
  // (Nothing is retained between reads: gc.test.ts watches the graph.)
  f.c = f.el = null;
  f.prediction = null;
  if (p === null) return; // no decision point reached: outside the table
  reads++;
  rowHits.set(p.row, (rowHits.get(p.row) ?? 0) + 1);
  const predicted = plainSlot(p.slot, el);
  // (A truth read's own NotReady is the T slot's: `truthRead` throws when
  // the truth is not available yet.)
  const actual =
    thrown !== SLOT_NONE
      ? thrown === SLOT_NR && f.actual === SLOT_T
        ? SLOT_T
        : thrown
      : plainSlot(f.actual, el);
  const posture = f.posture;
  const seat = currentSeat();
  if (predicted !== SLOT_SNAPSHOT && actual !== predicted)
    report(
      "INV-seat-5",
      p.row,
      c,
      el,
      `served slot is not the table's (${POSTURE_NAMES[posture]} posture; ${stateOf(c, el)})`,
      predicted,
      actual
    );
  if (seat !== null && c !== null && seat.node === c) {
    // A verdict read of a flight opens the flush's transaction if none has
    // (`joinFuture(null)`): the hold the seat names is the one the read
    // left behind.
    if (p.raise & (MARK_AH | RAISE_VSEAT | MARK_JF0) && p.tx === null) p.tx = flushTransaction;
    applyRaise(seat, p);
    // World agreement: the pass's own world against its flags (wiped at the
    // pass's head): JOINED is H, STAGED_READ is Fl. A leaf's too (INV-seat-1
    // as amended by D-27, 2026-10-28: a leaf that read a born node or the
    // hold's own staging is in the hold's world; one served the screen
    // raises nothing).
    if (!seat.known) {
      const flagWorld =
        c._flags & REACTIVE_JOINED ? WORLD_H : c._flags & REACTIVE_STAGED_READ ? WORLD_FL : WORLD_S;
      if (flagWorld !== seat.ownWorld)
        report(
          "INV-seat-3",
          p.row,
          c,
          el,
          `world after the read (old ${flagWorld}, new ${seat.ownWorld}; ${POSTURE_NAMES[posture]} posture; raise ${raiseNames(p.raise)}, ${stateOf(c, el)})`,
          predicted,
          actual
        );
      // Verdict seat agreement (today `passLane` is a verdict lane).
      const oldV = readerVhold();
      if (oldV !== (seat.vhold && resolveTx(seat.vhold)) && seat.lane === laneOf(passLane))
        report(
          "INV-seat-3",
          p.row,
          c,
          el,
          `verdict seat after the read (old ${oldV ? "seated" : "none"}, new ${seat.vhold ? "seated" : "none"}; ${POSTURE_NAMES[posture]} posture)`,
          predicted,
          actual
        );
    }
  } else if (c !== null) orphanReads++;
}

/** `recompute`'s head, after the old seating: the new seat beside it. */
export function shadowSeatOpen(
  el: Computed<any>,
  create: boolean,
  creator: Computed<any> | null,
  ownLane: Transaction | null,
  mount: unknown,
  creatorJoined: boolean
): Seat {
  const seat = openSeat(el, create, creator, ownLane);
  passes++;
  const old = laneOf(passLane);
  if (seat.lane !== old)
    report(
      "INV-seat-3",
      "B1",
      el,
      null,
      `seatLane (old ${old ? "lane" : "null"}, new ${seat.lane ? "lane" : "null"}; create ${create}, creator running ${seat.creatorRunning})`,
      0,
      0
    );
  const oldV = readerVhold();
  if (oldV !== (seat.vhold && resolveTx(seat.vhold)))
    report(
      "INV-seat-3",
      "B1",
      el,
      null,
      `verdict seat (old ${oldV ? "seated" : "none"}, new ${seat.vhold ? "seated" : "none"}; create ${create})`,
      0,
      0
    );
  // INV-seat-2: posture is the node's own.
  if (seat.posture !== postureOf(el, 0))
    report("INV-seat-2", "B1", el, null, "posture inherited", 0, 0);
  // Old "ahead" for a first pass: the mount (creator's lane or its mount's).
  // Old inherited world: the owner's computed's JOINED (F-mount reading B;
  // the seat reads the running pass, A — the two differ only for a
  // `runWithOwner` into an owner that is not the running pass).
  if (create) {
    const oldAhead = !!mount;
    if (oldAhead !== seat.ahead)
      report(
        "INV-seat-3",
        "B1",
        el,
        null,
        `ahead (old ${oldAhead}, new ${seat.ahead}; creator running ${seat.creatorRunning}, creator ${nameOf(creator)})`,
        0,
        0
      );
    // (F-mount, reading A: the creator is the running pass — the seat
    // stack's top; the old test reads the owner's flags. The two are one
    // when the owner is the running pass. A `runWithOwner` into another
    // owner — `<For>`'s lazy `mapArray` under the component's owner, an
    // ancestor pass still running or one not running at all — is the
    // retired path; the born-held decision at the close still compares.)
    const ownerIsRunningPass = creator === null || (depth > 0 && seats[depth - 1].node === creator);
    if (ownerIsRunningPass && creatorJoined !== (seat.creatorWorld === WORLD_H))
      report(
        "INV-seat-3",
        "B1",
        el,
        null,
        `inherited world (old creator ${creatorJoined ? "JOINED" : "not joined"}, new ${seat.creatorWorld}; creator running ${seat.creatorRunning})`,
        0,
        0
      );
  }
  return seat;
}

/** `recompute`'s finally: the born-held decision beside the old one. */
export function shadowSeatClose(
  el: Computed<any>,
  isEffect: boolean,
  oldJoined: boolean,
  oldCreator: Computed<any> | null,
  oldMount: unknown
): void {
  const seat = currentSeat();
  if (seat === null || seat.node !== el) {
    report("INV-seat", "B2", el, null, "no seat open for the pass", 0, 0);
    return;
  }
  const oldCreatorJoined = !!(oldCreator !== null && oldCreator._flags & REACTIVE_JOINED);
  // (A known difference in this pass: the two seats parted by construction.)
  if (seat.known) {
    seats[depth--] = null!;
    return;
  }
  // The lane the pass ends in (before `laneStage` judges whether it left).
  const old = laneOf(passLane);
  if (seat.lane !== old)
    report(
      "INV-seat-3",
      "B2",
      el,
      null,
      `seatLane at the pass's end (old ${old ? "lane" : "null"}, new ${seat.lane ? "lane" : "null"}; rows ${seat.trail.slice(-4).join(",")})`,
      0,
      0
    );
  const oldV = readerVhold();
  if (oldV !== (seat.vhold && resolveTx(seat.vhold)) && seat.lane === old)
    report(
      "INV-seat-3",
      "B2",
      el,
      null,
      `verdict seat at the pass's end (old ${oldV ? "seated" : "none"}, new ${seat.vhold ? "seated" : "none"}; rows ${seat.trail.slice(-4).join(",")})`,
      0,
      0
    );
  // (A pass a lane seats publishes as lane work today: the born-held arm is
  // not reached — the shadow compares only where it is.)
  if (seat.create && !seated(seat) && passLane === null) {
    const pending = (el._statusFlags & STATUS_PENDING) !== 0;
    const tick = flushTransaction !== null || passTx !== null;
    const oldBorn = tick && (oldJoined || oldCreatorJoined);
    const newBorn = bornHeld(seat, isEffect, pending);
    shadowOldCreator = oldCreator;
    const knownBorn =
      oldBorn !== newBorn && shadowKnown("born", "B2", +newBorn, +oldBorn, el, null, seat);
    shadowOldCreator = null;
    if (oldBorn !== newBorn && !knownBorn)
      report(
        "INV-seat-3",
        "B2",
        el,
        null,
        `born held (old ${oldBorn}, new ${newBorn}; world ${seat.world}/${seat.ownWorld}/${seat.creatorWorld}, ahead ${seat.ahead}, mount ${!!oldMount}, pending ${pending}, old creator ${
          oldCreator === null
            ? "none"
            : `${oldCreator._flags & REACTIVE_RECOMPUTING_DEPS ? "running" : "idle"} ${oldCreatorJoined ? "JOINED" : "not joined"} ${depth > 0 && seats[depth - 1].node === oldCreator ? "= running pass" : "≠ running pass"}`
        }, rows ${seat.trail.slice(-4).join(",")})`,
        0,
        0
      );
  }
  // (A boundary's output sets its own CONFIG_FRAME at the head of its body,
  // and a probe sets CONFIG_VERDICT: the node's own transitions.)
  const posture = postureOf(el, 0);
  if (
    seat.posture !== posture &&
    !(el._config & CONFIG_VERDICT) &&
    seat.posture !== POSTURE_V &&
    posture !== POSTURE_L
  )
    report(
      "INV-seat-2",
      "B2",
      el,
      null,
      `posture changed during the pass (${POSTURE_NAMES[seat.posture]} → ${POSTURE_NAMES[posture]})`,
      0,
      0
    );
  closeSeat(seat);
}

// Report sink: `globalThis.__SEAT_SHADOW__` for reporters; with
// `SEAT_SHADOW_REPORT=<file>` in the environment each worker appends its
// record at exit (JSON lines) — the differential across solid/web/the
// generator reads those.
if (__TEST__) {
  const g = globalThis as any;
  g.__SEAT_SHADOW__ = { report: shadowReport, reset: shadowReset };
  const proc = g.process;
  const file = proc?.env?.SEAT_SHADOW_REPORT;
  if (file && typeof proc.on === "function") {
    proc.on("exit", () => {
      try {
        const fs = proc.getBuiltinModule?.("node:fs");
        if (fs)
          fs.appendFileSync(file, JSON.stringify({ pid: proc.pid, ...shadowReport() }) + "\n");
      } catch {}
    });
  }
}
