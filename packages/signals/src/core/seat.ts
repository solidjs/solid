/**
 * The reader seat — the one answer to "which world does this read see".
 *
 * SHADOW (S0, `documentation/plans/reader-seat-rebuild.md`): every function
 * here is reachable only under `__TEST__`. It runs BESIDE the deciders it is
 * built to replace (`frameRead`, `bornInto`, `joinPass`, `stagedScreen`,
 * `stagedRead`, `readerSeesCommitted`, `read`/`serve`'s hold arms,
 * `recompute`'s head seating, `route`, `verdictValue`'s arms, `laneRead`'s
 * arms) and asserts agreement — slot identity, not value equality. Nothing
 * here has a side effect on a node: the seat is module state, and the raise
 * a row predicts is applied to this module's seat only, so the shadow is an
 * independent implementation of the table and the comparison is honest.
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
 * throws NotReady · E throws an error.
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
  GlobalQueue,
  latestOpened,
  passLane,
  passTx,
  resolveTx,
  sameLane,
  txOf,
  type Transaction
} from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

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
export const SLOT_NR = 6;
export const SLOT_E = 7;
/** A read served from a hydration snapshot — outside the table. */
export const SLOT_SNAPSHOT = 8;
const SLOT_NAMES = ["none", "C", "P", "Lv", "Dv", "T", "NR", "E", "snapshot"];

/** Side effects a row predicts, as a bit set. */
export const RAISE_FL = 1;
export const RAISE_H = 2;
export const RAISE_LANE = 4;
/** Stale reader of a hold: re-derived at its landing (`staleReader`). */
export const MARK_ST = 8;
/** Watches the seam (`stagedReaders`). */
export const MARK_W = 16;
/** Display-ahead: the pass is the hold's verdict lane's. */
export const MARK_AH = 32;
/** The tick joins the hold (`joinPassTx`) without the reader's world moving
 * — a leaf reading a born-held derivation (D-4, L4). */
export const MARK_TICK = 64;
/** A leaf's first pass read the hold's staging: born held (B2's leaf clause). */
export const MARK_HOLD = 128;
/** A leaf read a staging of this flush (L1): under a display-ahead mount
 * its first pass is born held (D-27, #4166 — B2's leaf clause, §6). */
export const MARK_SR = 256;
/** The pass enters the hold's verdict seat unconditionally (today
 * `enterLane` on a verdict lane's node — `route`'s "unless already seated"
 * test does not apply). */
export const RAISE_VSEAT = 512;
/** D-28 (#4275, #4284): a leaf seated as a hold's verdict reader reading a
 * lane that is not that hold's, or a flight never shown, leaves the verdict
 * seat first and reads from the frame's. */
export const MARK_LEAVE = 1024;

export interface Prediction {
  row: string;
  slot: number;
  raise: number;
  /** The hold the side effects name (ST(t), AH(t)). */
  tx: Transaction | null;
  /** The lane a RAISE_LANE moves the pass into. */
  lane: Transaction | null;
}

// ─── The seat ──────────────────────────────────────────────────────────────

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

/** The posture of a node from the node alone (INV-seat-2). `window`: 0
 * none, 1 `isPending`, 2 `latest` (2 wins — `latest` inside `isPending`
 * is `latest`'s value). */
export function postureOf(c: Computed<any> | null, window: number): number {
  if (c === null) return window ? (window === 2 ? POSTURE_VL : POSTURE_VP) : POSTURE_U;
  if (c._config & CONFIG_CHILDREN_FORBIDDEN) return POSTURE_F;
  if (c._config & CONFIG_AUTHORITATIVE) return POSTURE_A;
  if (window) return window === 2 ? POSTURE_VL : POSTURE_VP;
  // A pass that asked (`latest`/`isPending`) is a verdict reader from the
  // window on, and stays one on every re-run until a pass asks nothing
  // (D-25 "a verdict posture outlives the pass that asked"): the sticky
  // CONFIG_VERDICT, set at the window (`markVerdictReader`).
  if (c._config & CONFIG_VERDICT) return POSTURE_V;
  if ((c as any)._type === EFFECT_RENDER || c._config & CONFIG_FRAME) return POSTURE_L;
  return POSTURE_D;
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

/** Today's verdict seat: the hold whose verdict lane `passLane` is. */
function oldVerdictSeat(): Transaction | null {
  return passLane !== null && laneOf(passLane) === null ? resolveTx(passLane._parent!) : null;
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
  if (p.raise & RAISE_VSEAT && p.tx !== null) {
    // (A lane the pass sat in links to the verdict lane, `enterLane`.)
    seat.vhold = resolveTx(p.tx);
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

/** The lane a pass is seated in, as the old code spells it: a verdict lane
 * is a seating of posture V, not a lane (`verdicts have no node set`). */
function laneOf(t: Transaction | null): Transaction | null {
  return t !== null && t._parent?._verdict === t ? null : t;
}

// ─── The slot table ────────────────────────────────────────────────────────

function pred(
  row: string,
  slot: number,
  raise = 0,
  tx: Transaction | null = null,
  lane: Transaction | null = null
): Prediction {
  return { row, slot, raise, tx, lane };
}

/** The tick's hold: the flush's transaction, or the pass transaction
 * outside a flush. */
function tickHold(): Transaction | null {
  return flushTransaction ?? passTx;
}

/** "Born into t" for the reading pass (`bornInto`): its own node is held
 * by `t` and never committed. */
function seatBornInto(seat: Seat | null, t: Transaction): boolean {
  return seat !== null && seat.bornTx !== null && resolveTx(seat.bornTx) === resolveTx(t);
}

/** A28 — a write not yet flushed: the committed value is what the pass
 * sees, re-run in the flush that carries the write. (A held node rewritten
 * between flushes keeps its flushed stash: the slot is still the
 * staging's, served from the stash.) */
function unflushed(el: AnyNode): boolean {
  return (
    !globalQueue._running && el._pendingValue !== NOT_PENDING && !(el._config & CONFIG_PROMOTED)
  );
}

/**
 * The slot a read of `el` by `c` is served from, with the side effects the
 * row predicts. Pure: nothing on `c`, `el` or the seat is touched —
 * `shadowRead` applies the raise to the shadow seat after the comparison.
 *
 * @param c the reader (null: no pass)
 * @param el the node read
 * @param tracked the read is a tracked dependency read (`tracking`)
 * @param window 0 none · 1 `isPending` · 2 `latest`
 * @param spectate a bookkeeping read (`spectating`)
 * @param snapshot the read is served from a hydration snapshot (outside the table)
 */
export function slot(
  c: Computed<any> | null,
  el: AnyNode,
  tracked: boolean,
  window: number,
  spectate: boolean,
  snapshot: boolean
): Prediction {
  if (snapshot) return pred("—", SLOT_SNAPSHOT);
  const seat = currentSeat();
  const posture = postureOf(c, window);
  const cfg = el._config;
  const st = ((el as Computed<any>)._statusFlags as number | undefined) ?? 0;
  const isFn = typeof (el as Computed<any>)._fn === "function";
  const staged = el._pendingValue !== NOT_PENDING;
  const held = (cfg & CONFIG_HELD) !== 0;
  const uninit = (st & STATUS_UNINITIALIZED) !== 0;
  const pending = (st & STATUS_PENDING) !== 0;
  const errored = isFn && (st & STATUS_ERROR) !== 0;
  const laneNode = (cfg & CONFIG_OVERRIDE) !== 0;
  const guess = (cfg & CONFIG_GUESS) !== 0;
  const stagedError = (cfg & CONFIG_STAGED_ERROR) !== 0;
  /** The staging as a slot: its value, or the error it stages (D-41). */
  const stagedSlot = stagedError ? SLOT_E : SLOT_P;
  /** The screen as a slot: the committed value, or the error still shown
   * there — a write or retry has not yet replaced it (D-41 `throwShown`,
   * #4110). */
  const screen = isFn && el._x?._shownError ? SLOT_E : SLOT_C;
  /** f0: a flight with no value yet. */
  const firstFlight = pending && uninit;
  const inLane = seat !== null && seat.lane !== null;
  /** Today's `passLane !== null`: lane work, or a hold's verdict reader. */
  const inSeat = seated(seat);
  const cUninit = c !== null && (c._statusFlags & STATUS_UNINITIALIZED) !== 0;
  const cType = c !== null ? ((c as any)._type as number | undefined) : undefined;
  const running = globalQueue._running;
  /** D-41 (#2897): an errored derivation's retry — a tracked re-read on a
   * later cycle than the one that found the error re-runs it and reads
   * again; the re-read is compared on its own (a nested frame). */
  const retry = errored && tracked && c !== null && (el as Computed<any>)._time < clock;

  // ── U: no pass ──────────────────────────────────────────────────────────
  if (posture === POSTURE_U) {
    if (laneNode && !(errored && !guess)) {
      // Live guess / lane value (A17); none (born in the lane, nothing yet:
      // #4363) — as any read of it below.
      if (!laneNP(el, guess, staged, uninit)) return pred("U3", SLOT_LV);
      if (pending) return pred("U3", SLOT_NR);
    }
    if (firstFlight) return pred("U2", SLOT_NR); // F-9: no value yet
    // D-41: an errored derivation, or a shown error a write/retry has not
    // yet replaced on the screen (`_shownError`), is the screen's answer.
    if (errored || el._x?._shownError) return pred("U4", SLOT_E);
    if (uninit && staged) return pred("U2", SLOT_NR); // D-24: born held, no screen
    return pred("U1", SLOT_C); // D-29 D-34 F-10 (s unflushed: C)
  }

  // ── F: children-forbidden (the frame; A32) ─────────────────────────────
  if (posture === POSTURE_F) {
    if (laneNode && !(errored && !guess)) {
      if (!dispNP(el, uninit)) return pred("F1", SLOT_DV);
      if (pending) return pred("F1", SLOT_NR); // nothing shown yet (#4362)
    }
    if (retry) return pred("F1", SLOT_SNAPSHOT);
    if (errored) return pred("F1", SLOT_E);
    if (firstFlight || (uninit && staged)) return pred("F1", SLOT_NR);
    // D-29: the committed value (lane work's frame reader over a flight:
    // the screen, `throwShown`).
    return pred("F1", pending && inSeat && !cUninit ? screen : SLOT_C);
  }

  // ── A: authoritative (`until`, `refresh`) ──────────────────────────────
  if (posture === POSTURE_A) {
    if (laneNode && !(errored && !guess)) {
      // A folded guess (D-34) is the hold's world; `truthRead` otherwise.
      const l = txOf(el);
      if (l.folded && guess && seat !== null && seat.lane === null)
        return pred("A1", staged ? SLOT_P : SLOT_C, RAISE_H, resolveTx(l._parent ?? l));
      return pred("A1", SLOT_T); // D-31
    }
    // "other → as D": fall through with D's rows under the A row id.
  }

  // ── Vl / Vp: inside a window (`latest` / `isPending`) ──────────────────
  if (posture === POSTURE_VL || posture === POSTURE_VP) {
    const p = windowRow();
    // A live `affects()` mark on the node or a dependency (affects.ts): not
    // final by declaration; in a flush with a hold the reader is its
    // verdict reader whatever the value's row says.
    if (
      posture === POSTURE_VP &&
      tracked &&
      c !== null &&
      !(c._config & CONFIG_CHILDREN_FORBIDDEN) &&
      flushTransaction !== null &&
      GlobalQueue._marked?.(el as Computed<any>)
    ) {
      p.raise |= MARK_AH;
      if (p.tx === null) p.tx = flushTransaction;
    }
    return p;
  }
  function windowRow(): Prediction {
    const latest = posture === POSTURE_VL;
    const owned = c !== null && !(c._config & CONFIG_CHILDREN_FORBIDDEN);
    const tr = owned && tracked;
    /** The seam's verdict for a staging or flight not held
     * (`provisionalVerdict`): once the flush has a hold the reader is its
     * verdict reader at once (`route`); before, it watches the seam. */
    const seam = tr && running ? (flushTransaction !== null ? MARK_AH : MARK_W) : 0;
    /** The seam's verdict for a flight (`pendingVerdict`): `latest` opens
     * the flush's transaction for it (the reader is its verdict reader at
     * once); `isPending` watches the seam before anything joined. */
    const seamFlight = tr && running ? (latest || flushTransaction !== null ? MARK_AH : MARK_W) : 0;
    if (laneNode && !(errored && !guess)) {
      // Vl5 (D-22 D-34): a guess is the value; a derivation the lane's
      // latest unless in flight, else its display. `isPending` reads the
      // display. The pass is the holder's verdict reader (AH(parent)).
      const l = txOf(el);
      const flying = pending; // (quiet re-asks are the verdict's business, not the slot's)
      const parent = l._parent ?? l;
      const row = latest ? "Vl5" : "Vp1";
      if (guess)
        return pred(
          row,
          latest && l.folded ? (staged ? SLOT_P : SLOT_C) : SLOT_LV,
          tr ? MARK_AH : 0,
          parent
        );
      // A derivation with nothing in either view (born in the lane, its
      // first flight up, #4362 #4363): read as any uninitialized node —
      // NotReady in flight, else its staging or screen (A7, A19 exc. 1),
      // the reader not moved into the verdict seat.
      if (latest && !flying ? laneNP(el, guess, staged, uninit) : dispNP(el, uninit)) {
        if (staged && !(pending && !uninit))
          return pred(row, latest && running ? stagedSlot : SLOT_C, seam, flushTransaction);
        if (pending)
          return pred(row, uninit ? SLOT_NR : SLOT_C, uninit ? 0 : seamFlight, flushTransaction);
        return pred(row, errored ? SLOT_E : SLOT_C);
      }
      // A first load in flight with nothing produced yet (D-22): loading —
      // unless an error answered it first (`isPending`: the error is the
      // display, D-41 #4375).
      if (flying && uninit && el._x!._lane === el._value && (latest || !el._x!._shownError))
        return pred(row, SLOT_NR, tr ? MARK_AH : 0, parent);
      return pred(row, latest && !flying ? SLOT_LV : SLOT_DV, tr ? MARK_AH : 0, parent);
    }
    // (An error is thrown last, as `verdictValue` does: a held or staged
    // node answers through the rows above it, D-41.)
    if (held) {
      const t = txOf(el);
      if (!uninit) {
        // Vl1' (#3460, as L7): a render effect outside the hold's own flush
        // while its verdict lane is blocked is a stale reader of it — the
        // screen now, re-derived at the reveal. (`latest` only: `isPending`
        // is answered either way.)
        if (
          latest &&
          tr &&
          cType === EFFECT_RENDER &&
          !inSeat &&
          t._verdict?._held &&
          flushTransaction !== t
        )
          return pred("Vl1'", SLOT_C, MARK_ST, t);
        // Vl1 (D-22 F-6): the proposal — a staged error included (D-41:
        // `staged` throws it); `isPending`'s value is the screen's (Vp1).
        if (latest && staged) return pred("Vl1", stagedSlot, tr ? MARK_AH : 0, t);
        return pred(latest ? "Vl1" : "Vp1", SLOT_C, tr ? MARK_AH : 0, t);
      }
      // Born into the future: its staging is its only value (Vl4 b → P; Vp2:
      // owned, as a plain read — the owner joins the hold).
      if (staged && !pending)
        return pred(latest ? "Vl4" : "Vp2", stagedSlot, owned && !latest ? RAISE_H : 0, t);
      return pred(latest ? "Vl4" : "Vp2", SLOT_NR, 0, t); // f0
    }
    if (staged && !(pending && !uninit)) {
      // Vl2/Vl3 (D-22 D-32 F-10 [R5]): in a flush the staging — the seam's
      // verdict (`provisionalVerdict`); outside a flush the committed
      // value and a late re-run. `isPending`: the screen.
      if (latest) {
        if (running) return pred("Vl2", stagedSlot, seam, flushTransaction);
        return pred("Vl3", SLOT_C);
      }
      return pred("Vp1", SLOT_C, running ? seam : tr ? MARK_W : 0, flushTransaction);
    }
    if (pending) {
      if (uninit) return pred(latest ? "Vl4" : "Vp2", SLOT_NR); // f0: loading, not pending
      // Vl4' (#3376, D-22): a staging beneath a newer question in flight —
      // the stale first hop of a chain. `latest` shows the proposal (the
      // staging is newer than the screen); the verdict is the flight's
      // (`pendingVerdict`). `isPending` reads the screen (Vp1). Traced
      // 2026-10-29 (S1 M1, generator seed 3289 #310).
      if (latest && staged)
        return running
          ? pred("Vl4'", stagedSlot, seamFlight, flushTransaction)
          : pred("Vl4'", SLOT_C); // outside a flush: an unflushed write (A28), as Vl3
      // f: below the async nothing newer exists — the seam's verdict
      // (`pendingVerdict`).
      return pred(latest ? "Vl4" : "Vp1", SLOT_C, seamFlight, flushTransaction);
    }
    if (errored) return pred(latest ? "Vl4" : "Vp1", SLOT_E);
    return pred(latest ? "Vl4" : "Vp1", SLOT_C);
  }

  // ── Common arms for L / D / V / A-as-D ─────────────────────────────────
  const leaf = posture === POSTURE_L;
  // (A truth reader that is also a verdict reader — F-6's flag copy, a
  // window of its own — reads a hold's node as a verdict reader does:
  // `truthRead` is for lane nodes only.)
  const verdictReader =
    posture === POSTURE_V || (posture === POSTURE_A && (c!._config & CONFIG_VERDICT) !== 0);
  const rowBase = posture === POSTURE_A ? "A1/" : "";
  const isEffect = !!cType;
  // D-28's leaf treatment of a lane (L6/L7: a stale reader of the lane,
  // re-derived at the reveal) is a render effect's — the binding that
  // shows. A boundary's structure (CONFIG_FRAME, posture L on the plain
  // rows per #4283) reads a lane as a derivation does: it enters. Read as
  // a leaf, a fallback-showing `<Loading>` whose `on` is `latest(b)` would
  // hold `latest(b)` (lane-hold-on-observation), and a boundary's content
  // would serve a flight committed beneath its inputs — a tear A15's
  // reveal corollary forbids for every reader kind (l2-fuzz-existing-rules,
  // seed 3289 #922). Traced 2026-10-29 (S1 M1).
  const renderLeaf = cType === EFFECT_RENDER && (leaf || verdictReader);
  /** The lane rows' side effects, carried into the plain rows when the
   * lane has nothing to serve (`laneRead` returns NOT_PENDING and `read`
   * goes on). */
  let laneRaise = 0;
  let laneTx: Transaction | null = null;
  let laneInto: Transaction | null = null;
  let laneRow = "";

  // Lane node (CONFIG_OVERRIDE): the lane rows (`laneRead`).
  if (laneNode && !(errored && !guess)) {
    const l = txOf(el);
    const vlane = laneOf(l) === null;
    const flying = pending && !guess;
    const cHeldByFlush =
      c !== null &&
      (c._config & CONFIG_HELD) !== 0 &&
      flushTransaction !== null &&
      resolveTx(flushTransaction) === txOf(c);
    const row = vlane ? "V6" : "";
    // Entering the lane: a lane's — the pass is the lane's (D4, [R4]); a
    // verdict lane's — the pass is the hold's verdict reader, unless its
    // branch exists only in the future (`creatorReads`: a pass whose
    // running creators, or itself when a memo, read the future or a
    // staging — D-25, D-26, #4341).
    const enter = vlane
      ? inSeat || !(seat!.creatorsWorld > WORLD_S || (!isEffect && seat!.ownWorld > WORLD_S))
        ? RAISE_VSEAT
        : 0
      : RAISE_LANE;
    const enterTx = vlane ? l._parent : null;
    const enterInto = vlane ? null : l;
    const laneHas = !laneNP(el, guess, staged, uninit) && !flying;
    // A folded lane (D-34): a deriving pass outside the lane reads the
    // hold's world and joins it; lane work and leaves keep the guess.
    if (l.folded && guess && !inLane && !leaf && (el as any)._host?._fam?.node !== c)
      return pred(rowBase + "D4'", staged ? SLOT_P : SLOT_C, RAISE_H, resolveTx(l._parent ?? l));
    if (!tracked) {
      // An untracked read outside lane work: the screen (D4''); inside, the
      // pass derives from the lane like a tracked one (enters).
      if (!inSeat) {
        if (!dispNP(el, uninit)) return pred(row || rowBase + "D4''", SLOT_DV);
        laneRow = row || "D4''";
      } else if (laneHas) return pred(row || rowBase + "D4", SLOT_LV, enter, enterTx, enterInto);
      else {
        laneRaise = enter;
        laneTx = enterTx;
        laneInto = enterInto;
        laneRow = row || "D4";
      }
    } else if (renderLeaf) {
      const never = flying && el._x!._lane === NOT_PENDING;
      // D-28 (#4275, #4284): a leaf seated as a hold's verdict reader
      // leaves the seat on a flight never shown, or for a lane that is not
      // that hold's, and reads from the frame's seat.
      const leave =
        seat!.vhold !== null &&
        (never || !vlane || resolveTx(seat!.vhold) !== resolveTx(l._parent!))
          ? MARK_LEAVE
          : 0;
      const laneSeat = leave ? null : vlane ? (seat!.vhold !== null ? l : null) : seat!.lane;
      let stale = false;
      if (laneSeat === null || !sameLane(laneSeat, l)) {
        // A flight never shown waits (NR); the lane has never shown: the
        // screen is the committed value.
        if (never && l._shown) return pred(row || "L7", SLOT_NR, MARK_ST | leave, l);
        // L7' (D-2): a leaf the flush's hold holds reads a lane derivation's
        // staging — the hold's own value.
        if (!guess && staged && cHeldByFlush) return pred(row || "L7'", SLOT_P, leave);
        if (l._held || flying) {
          // D-26 D-28: a stale reader of the lane — the display, re-derived
          // at the reveal; nothing on screen yet (uninitialized): NR
          // (#4338).
          if (dispNP(el, uninit)) return pred(row || "L7", SLOT_NR, MARK_ST | leave, l);
          return pred(row || "L7", SLOT_DV, MARK_ST | leave, l);
        }
        stale = true;
      }
      // D-26 D-37: the lane's value; a flight of the lane's own is the
      // lane's wait (NR: lane work throws on its own flights, D-37).
      if (laneHas) return pred(row || "L6", SLOT_LV, enter | leave, enterTx, enterInto);
      laneRaise = enter | leave;
      laneTx = enterTx;
      laneInto = enterInto;
      laneRow = row || (stale ? "L7" : "L6");
    } else {
      // D4 (D-37 D-25 [R4]): the lane's value, the pass enters the lane
      // (links if it already sits in another). A lane derivation in flight:
      // the pass has entered and the flight is the lane's own — NR (D4''',
      // D-37).
      if (laneHas) return pred(row || rowBase + "D4", SLOT_LV, enter, enterTx, enterInto);
      laneRaise = enter;
      laneTx = enterTx;
      laneInto = enterInto;
      laneRow = row || rowBase + (flying ? "D4'''" : "D4");
    }
    // Nothing to serve from the lane: `read` goes on with the lane entered
    // (`laneRead` returned NOT_PENDING). A flight: NR; else the plain rows.
    if (flying) return pred(laneRow, SLOT_NR, laneRaise, laneTx, laneInto);
  }
  const carry = (p: Prediction): Prediction => {
    if (laneRaise) {
      p.raise |= laneRaise;
      if (p.tx === null) p.tx = laneTx;
      if (p.lane === null) p.lane = laneInto;
      p.row = laneRow + "→" + p.row;
    }
    return p;
  };
  const latestOnly =
    flushTransaction !== null && flushTransaction === latestOpened && !inSeat && !cUninit;
  /** `stagedScreen`: a verdict reader's plain read of a staging is the
   * screen's once the frame has a hold (not one a `latest()` alone
   * opened), unless born into it. */
  const stagedScreen =
    flushTransaction !== null && !seatBornInto(seat, flushTransaction) && !latestOnly;

  // Error (D-41 #2897): the error — the retry re-reads (compared on its
  // own). The hold arms run first (`read`'s L2 block): a derivation of a
  // held errored node joins before it throws. A staged error replacing the
  // shown one (`stageError`) is served as the staging would be: a reader
  // served the screen throws the shown error, one served the staging
  // throws the staged one and stages its own with it (Fl).
  if (errored) {
    const row = leaf ? "L8" : rowBase + "D5";
    const p = held ? heldRow(row) : pred(row, SLOT_E);
    p.slot = retry ? SLOT_SNAPSHOT : SLOT_E;
    if (
      !retry &&
      stagedError &&
      !uninit &&
      !(p.raise & MARK_ST) &&
      !(verdictReader && c!._config & CONFIG_VERDICT && stagedScreen)
    )
      p.raise |= RAISE_FL;
    return carry(p);
  }

  // Held node.
  if (held) return carry(heldRow(""));

  function heldRow(errRow: string): Prediction {
    const t = txOf(el);
    const own = t === flushTransaction || seatBornInto(seat, t);
    const r = (row: string, slot: number, raise = 0, tx: Transaction | null = t) =>
      pred(errRow || row, slot, raise, tx);
    if (leaf) {
      // L4 (D-9 D-2 D-27): inputs published, or born — the leaf has no
      // screen to fall back to; it joins the hold (D-4): its world is the
      // hold's and its children inherit it (INV-seat-1 as amended).
      // (A staged error throws, D-41 — the 50k differential's L4 finding.)
      if (uninit)
        return r("L4", pending ? SLOT_NR : staged ? stagedSlot : SLOT_C, RAISE_H | MARK_TICK);
      if (cfg & CONFIG_INPUTS_PUBLISHED)
        return r("L4", pending ? SLOT_NR : staged ? stagedSlot : SLOT_C, RAISE_H);
      if (seatBornInto(seat, t))
        return r("L2", pending ? SLOT_NR : staged ? stagedSlot : SLOT_C, RAISE_H); // D-2
      if (inSeat && !(cUninit && pending)) return r("D6", screen, MARK_ST); // lane work: the screen (D-37)
      if (own) return r("L2", pending ? SLOT_NR : staged ? stagedSlot : SLOT_C, RAISE_H); // D-3 D-2
      return r("L3", screen, MARK_ST); // D-3 D-9 D-26
    }
    if (verdictReader) {
      // V1 (D-23 A10 [R7]): a verdict reader is a frame reader — the
      // screen, re-derived at the landing — unless born into t.
      if (seatBornInto(seat, t))
        return r("V1'", pending ? SLOT_NR : staged ? stagedSlot : SLOT_C, RAISE_H);
      if (uninit) return r("V1''", pending ? SLOT_NR : stagedSlot, RAISE_H); // no screen to serve
      return r("V1", screen, MARK_ST);
    }
    if (inSeat) {
      // D6 (D-37): lane work reading a hold's node — the screen, re-derived
      // at that landing; a lane pass with no value yet over a flight enters.
      if (!(cUninit && pending) && !uninit && !seatBornInto(seat, t))
        return r(rowBase + "D6", screen, MARK_ST);
      return r(rowBase + "D6'", pending ? SLOT_NR : staged ? stagedSlot : SLOT_C, RAISE_H);
    }
    // D2 (D-1 D-2 D-10): the pass derives from the hold.
    if (pending) return r(rowBase + "D2'", SLOT_NR, RAISE_H);
    return r(rowBase + "D2", staged ? stagedSlot : SLOT_C, RAISE_H);
  }

  // Staged this flush, not held.
  if (staged) {
    if (unflushed(el) && !uninit) {
      // A28 / F-10: an unflushed write — the committed value now and a late
      // re-run in the flush that carries it (`markLateLinker`).
      return carry(pred(leaf ? "L1'" : rowBase + "D1'", SLOT_C));
    }
    if (uninit && !pending && spectate) return carry(pred("U2", SLOT_NR));
    // (F-9, as D1/L1: a staging beneath a flight is not what the reader
    // sees — the flight decides below. The 50k differential's V3 finding.)
    if (!pending) {
      // D1'' / L1'' / V3'' (D-8, #4452): a signal's staging equal to its
      // committed value is writes that netted — no proposal, so the read
      // is the screen's: the slot is still P (the same value), no mark.
      const netted = !isFn && el._pendingValue === el._value;
      if (verdictReader && !uninit && c!._config & CONFIG_VERDICT) {
        // V2/V3 (D-23 D-32 [R5]): the screen once the tick has a hold, the
        // staging before (the seam's verdict).
        if (stagedScreen) return carry(pred("V2", screen, MARK_ST, flushTransaction));
        if (netted) return carry(pred("V3''", stagedSlot));
        return carry(pred("V3", stagedSlot, RAISE_FL | MARK_W, tickHold()));
      }
      if (inLane && seat!.lane!.folded && stagedScreen && !uninit)
        return carry(pred(rowBase + "D7'", SLOT_C, MARK_ST, flushTransaction)); // folded lane work reads the screen (D-34)
      const row = renderLeaf ? "L1" : inLane ? rowBase + "D7" : rowBase + "D1";
      // A pass reading a node born staged (uninitialized) has no screen to
      // re-derive on: no Fl mark (#3969), the value is still the staging's.
      // Nor a netted signal's (D1'' / L1'', above).
      const raise =
        uninit || netted ? 0 : RAISE_FL | (inSeat || (isEffect && verdictReader) ? MARK_W : 0);
      const lane = inLane ? seat!.lane : null;
      return carry(pred(netted ? row + "''" : row, stagedSlot, raise, null, lane));
    }
  }

  // A flight, not held.
  if (pending) {
    // D-37: not the lane's own, the pass has a value — and so does the
    // node (a first load in flight has no screen: NR, F-2).
    if (inSeat && !cUninit && !uninit) return carry(pred(rowBase + "D8", screen));
    if (verdictReader && !uninit) {
      if (cfg & CONFIG_INPUTS_PUBLISHED) return carry(pred("V4'", SLOT_NR, 0, flushTransaction));
      // D-23 D-9: the screen; in a flush the pass is the hold's verdict
      // reader and a stale reader of the flight (`observeFlight`).
      if (running) return carry(pred("V4", screen, MARK_ST | MARK_AH, flushTransaction));
      return carry(pred("V4", screen));
    }
    return carry(pred(leaf ? "L5" : rowBase + "D3", SLOT_NR)); // F-2 D-28 / F-2 D-9
  }

  return carry(pred(leaf ? "L0" : rowBase + "D0", SLOT_C)); // committed only
}

/** `laneValueOf(el) === NOT_PENDING`: a lane node with nothing in either
 * view (born in the lane, uninitialized, nothing produced). */
function laneNP(el: AnyNode, guess: boolean, staged: boolean, uninit: boolean): boolean {
  if (!guess && staged) return false;
  return el._x!._lane === NOT_PENDING && uninit;
}
/** `display(el) === NOT_PENDING`: nothing on screen for a lane node. */
function dispNP(el: AnyNode, uninit: boolean): boolean {
  const l = el._x!;
  return !(l._transaction!._shown && l._lane !== NOT_PENDING) && uninit;
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

// Per-read frames: the decision point stores the prediction and a snapshot of
// the reader's flags; the return site stores the slot the old decider chose.
interface ReadFrame {
  c: Computed<any> | null;
  el: AnyNode | null;
  prediction: Prediction | null;
  flagsBefore: number;
  laneBefore: Transaction | null;
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
    flagsBefore: 0,
    laneBefore: null,
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

/** The decision point of `read`/`verdictValue`: where today's deciders
 * begin. Records the prediction for the frame on top. */
export function shadowExpect(
  c: Computed<any> | null,
  el: AnyNode,
  tracked: boolean,
  window: number,
  spectate: boolean,
  snapshot: boolean
): void {
  if (readDepth < 0) return;
  const f = frames[readDepth];
  f.c = c;
  f.el = el;
  f.flagsBefore = c !== null ? c._flags : 0;
  f.laneBefore = passLane;
  f.posture = postureOf(c, window);
  f.prediction = slot(c, el, tracked, window, spectate, snapshot);
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
  applyRaise(seat, pred("ext", raise, raise, tx, lane));
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
  if (laneOf(l) === null) shadowExternalRaise(out, RAISE_VSEAT, null, l._parent);
  else shadowExternalRaise(out, RAISE_LANE, l);
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

/** A return site of the old deciders: the slot it serves. */
export function shadowActual(s: number): void {
  if (readDepth >= 0) frames[readDepth].actual = s;
}

/** The body returned (or threw: `thrown` is the slot of the throw). Compare,
 * apply the predicted raise to the shadow seat, pop. */
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
   * pass in, or the born-held decision at the pass's close. */
  kind: "slot" | "world" | "born";
  /** The row (a read's) or "B2" (the close's). */
  row: string;
  /** The table's answer and today's (a slot, a world, or 1/0 for born). */
  expected: number;
  actual: number;
  when: (c: Computed<any>, el: AnyNode | null, seat: Seat) => boolean;
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
    when: (c, el, seat) =>
      (c._config & CONFIG_VERDICT) !== 0 &&
      flushTransaction !== null &&
      seatBornInto(seat, txOf(el!)) &&
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
    when: (c, el, seat) => {
      const l = el!._x?._transaction;
      return (
        (c as any)._type === EFFECT_RENDER &&
        seat.vhold !== null &&
        !!l &&
        l._lane &&
        laneOf(l) === null &&
        l._parent !== null &&
        resolveTx(l._parent) !== l._parent &&
        resolveTx(l._parent) === resolveTx(seat.vhold)
      );
    }
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
  if (c === null || seat === null || seat.node !== c) return false;
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
  // (A truth read's own NotReady is the T slot's: `truthRead` throws when
  // the truth is not available yet.)
  const actual =
    thrown !== SLOT_NONE ? (thrown === SLOT_NR && f.actual === SLOT_T ? SLOT_T : thrown) : f.actual;
  const posture = f.posture;
  const seat = currentSeat();
  // A known difference (filed): the read's side effects on the seat are
  // the table's (the swap's behaviour); the old seat is not compared after
  // it this pass, as the two have parted by construction.
  if (
    p.slot !== SLOT_SNAPSHOT &&
    actual !== p.slot &&
    shadowKnown("slot", p.row, p.slot, actual, c, el, seat)
  ) {
    if (seat !== null && c !== null && seat.node === c) {
      if (p.raise & (MARK_AH | RAISE_VSEAT) && p.tx === null) p.tx = flushTransaction;
      applyRaise(seat, p);
      seat.known = true;
    }
    return;
  }
  if (p.slot !== SLOT_SNAPSHOT && actual !== p.slot)
    report(
      "INV-seat-3",
      p.row,
      c,
      el,
      `slot (${POSTURE_NAMES[posture]} posture; ${stateOf(c, el)})`,
      p.slot,
      actual
    );
  if (seat !== null && c !== null && seat.node === c) {
    // A verdict read of a flight opens the flush's transaction if none has
    // (`observeFlight`, `joinFuture(null)`): the hold the seat names is the
    // one the read left behind.
    if (p.raise & (MARK_AH | RAISE_VSEAT) && p.tx === null) p.tx = flushTransaction;
    applyRaise(seat, p);
    // World agreement: the pass's own world against its flags (wiped at the
    // pass's head): JOINED is H, STAGED_READ is Fl. A leaf's too (INV-seat-1
    // as amended by D-27, 2026-10-28: a leaf that read a born node or the
    // hold's own staging is in the hold's world; one served the screen
    // raises nothing).
    if (actual === p.slot && !seat.known) {
      const flagWorld =
        c._flags & REACTIVE_JOINED ? WORLD_H : c._flags & REACTIVE_STAGED_READ ? WORLD_FL : WORLD_S;
      if (flagWorld !== seat.ownWorld) {
        // A known difference (filed): the two worlds have parted for the
        // rest of this pass.
        if (shadowKnown("world", p.row, seat.ownWorld, flagWorld, c, el, seat)) {
          seat.known = true;
          return;
        }
        report(
          "INV-seat-3",
          p.row,
          c,
          el,
          `world after the read (old ${flagWorld}, new ${seat.ownWorld}; ${POSTURE_NAMES[posture]} posture; raise ${p.raise}, ${stateOf(c, el)})`,
          p.slot,
          actual
        );
      }
      // Verdict seat agreement (today `passLane` is a verdict lane).
      const oldV = oldVerdictSeat();
      if (oldV !== (seat.vhold && resolveTx(seat.vhold)) && seat.lane === laneOf(passLane))
        report(
          "INV-seat-3",
          p.row,
          c,
          el,
          `verdict seat after the read (old ${oldV ? "seated" : "none"}, new ${seat.vhold ? "seated" : "none"}; ${POSTURE_NAMES[posture]} posture)`,
          p.slot,
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
  const oldV = oldVerdictSeat();
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
  const oldV = oldVerdictSeat();
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
