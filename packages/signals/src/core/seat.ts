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
 * - Ahead — the creator was display-ahead (verdict posture or in a lane)
 *   when it made this node; D-27: a mount under a display-ahead reader is
 *   mainline, and a first pass reading a staging under it is born held.
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
  REACTIVE_STAGED_READ,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import {
  flushTransaction,
  globalQueue,
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
  world: number;
  lane: Transaction | null;
  ahead: boolean;
  posture: number;
  /** The hold this pass was born into (`bornInto`): held, uninitialized or
   * a held frame member. Its world is that hold's (H) from the start. */
  bornTx: Transaction | null;
  /** The creator's lane at birth (today's `prevLane`): the nested
   * derivation exclusion of B2 (#4203, #4340) reads it. */
  creatorLane: Transaction | null;
  /** The creator is display-ahead itself (in a lane, or a verdict reader),
   * not merely under a display-ahead mount: B2's nested-derivation
   * exclusion (#4203, #4340) is for the latter. */
  creatorDirect: boolean;
  creatorRunning: boolean;
  /** A leaf's first pass read the hold's staging (L2/L4): its first run is
   * the hold's — born held without its world moving (design doc §6, B2). */
  bornLeaf: boolean;
  /** A leaf read a staging of the flush (L1, MARK_SR). */
  sawStaging: boolean;
  /** The world the pass opened in (inherited or born): the old code has no
   * such thing for a staging (its STAGED_READ is per pass), so the world
   * comparison starts from here. */
  openWorld: number;
  /** The pass probed (a `latest`/`isPending` read) while still reading the
   * screen: a verdict reader from there (D-25; today `route`). */
  probed: boolean;
  /** The rows this pass hit, for the report. */
  trail: string[];
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
  if (c._config & CONFIG_VERDICT) return POSTURE_V;
  // A pass that probed while reading the screen is a verdict reader for the
  // rest of the pass (D-25: the probe decides the posture in either order).
  const seat = currentSeat();
  if (seat !== null && seat.node === c && seat.probed) return POSTURE_V;
  if ((c as any)._type === EFFECT_RENDER || c._config & CONFIG_FRAME) return POSTURE_L;
  return POSTURE_D;
}

/** B1 — open the seat of a pass at `recompute`'s head. `creator` is the
 * pass the creation belongs to (`creatorPass(context)`), running or not.
 * `ownLane` is the node's own lane (LANE_DIRTY, or OVERRIDE without GUESS,
 * on a lane's transaction), decided by the caller from the node. */
export function openSeat(
  el: Computed<any>,
  create: boolean,
  creator: Computed<any> | null,
  ownLane: Transaction | null
): Seat {
  // The creator's seat, if its pass is running — the top of the stack, or
  // deeper (a `runWithOwner` into an outer pass's owner from a nested pass).
  let parent: Seat | null = null;
  if (create && creator !== null)
    for (let i = depth; i >= 0; i--)
      if (seats[i].node === creator) {
        parent = seats[i];
        break;
      }
  const creatorRunning = parent !== null;
  const bornTx =
    el._config & CONFIG_HELD &&
    (el._statusFlags & STATUS_UNINITIALIZED || el._config & CONFIG_HELD_FRAME)
      ? txOf(el)
      : null;
  let world = WORLD_S;
  let lane: Transaction | null = null;
  let ahead = false;
  let creatorDirect = false;
  if (bornTx !== null) world = WORLD_H;
  if (creatorRunning) {
    // First pass: {world, lane, ahead} from the running creator pass.
    const p = parent!;
    if (p.world > world) world = p.world;
    // Display-ahead: in a lane, or a verdict reader (its posture NOW — a
    // probe in the body made it one) still reading the screen (#4341: a V
    // pass in a world ≥ Fl reads as D).
    creatorDirect = p.lane !== null || isAhead(postureOf(p.node, 0));
    ahead = p.ahead || p.lane !== null || (isAhead(postureOf(p.node, 0)) && p.world === WORLD_S);
    // The creator's lane is inherited unless it is a verdict lane: a verdict
    // lane's mount is a mainline mount (D-27, #3851).
    lane = p.lane !== null && p.lane._parent?._verdict !== p.lane ? p.lane : null;
  }
  // (A verdict lane is a seating of posture V, not a lane: `laneOf`.)
  if (ownLane !== null) lane = laneOf(ownLane);
  const seat: Seat = {
    node: el,
    create,
    world,
    lane,
    ahead,
    posture: POSTURE_U,
    bornTx,
    creatorLane: parent !== null ? parent.lane : null,
    creatorDirect,
    creatorRunning,
    bornLeaf: false,
    sawStaging: false,
    openWorld: world,
    // Finding F-vlane (design doc §7): a node whose staging sits in a
    // verdict lane re-passes as verdict work today through the lane's node
    // set — a pending re-pass whose CONFIG_VERDICT the head cleared (#3884)
    // and a boundary's display-ahead swap (#3540) included. The brief gives
    // verdicts no node set; the shadow models the memory as a pass opening
    // probed, so the slot comparison stays meaningful.
    probed: ownLane !== null && laneOf(ownLane) === null,
    trail: []
  };
  seats[++depth] = seat;
  seat.posture = postureOf(el, 0);
  return seat;
}

function isAhead(posture: number): boolean {
  return posture === POSTURE_V || posture === POSTURE_VL || posture === POSTURE_VP;
}

/** B2 — the born-held decision at a first pass's end: the tick has a hold
 * and the pass derived from it (world H), or it is a display-ahead mount's
 * first pass that read a staging (ahead, world ≥ Fl) — unless a nested
 * derivation left pending (#4203, #4340): no render effect reaches it yet. */
export function bornHeld(seat: Seat, isEffect: boolean, pending: boolean): boolean {
  if (!seat.create) return false;
  if (flushTransaction === null && passTx === null) return false;
  if (seat.ahead && seat.creatorLane === null && !seat.creatorDirect && !isEffect && pending)
    return false;
  return (
    seat.world === WORLD_H ||
    seat.bornLeaf ||
    (seat.ahead && (seat.world >= WORLD_FL || seat.sawStaging))
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
  if (p.raise & MARK_AH && seat.world === WORLD_S && seat.lane === null) seat.probed = true;
  if (p.raise & RAISE_H && seat.world < WORLD_H) seat.world = WORLD_H;
  if (p.raise & RAISE_FL && seat.world < WORLD_FL) seat.world = WORLD_FL;
  if (p.raise & RAISE_LANE && laneOf(p.lane) !== null) {
    const l = p.lane!;
    const s = seat.lane;
    if (s === null || sameLane(s, l) || !under(s, l)) seat.lane = l;
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
  const born = held && uninit && staged && !pending;
  /** f0: a flight with no value yet. */
  const firstFlight = pending && uninit;
  const inLane = seat !== null && seat.lane !== null;

  // ── U: no pass ──────────────────────────────────────────────────────────
  if (posture === POSTURE_U) {
    if (laneNode && !(errored && !guess)) return pred("U3", SLOT_LV); // live guess / lane value (A17)
    if (firstFlight) return pred("U2", SLOT_NR); // F-9: no value yet
    // D-41: an errored derivation, or a shown error a write/retry has not
    // yet replaced on the screen (`_shownError`), is the screen's answer.
    if (errored || el._x?._shownError) return pred("U4", SLOT_E);
    if (uninit && staged) return pred("U2", SLOT_NR); // D-24: born held, no screen
    return pred("U1", SLOT_C); // D-29 D-34 F-10 (s unflushed: C)
  }

  // ── F: children-forbidden (the frame; A32) ─────────────────────────────
  if (posture === POSTURE_F) {
    if (laneNode && !(errored && !guess)) return pred("F1", SLOT_DV);
    if (errored) return pred("F1", SLOT_E);
    if (firstFlight || (uninit && staged)) return pred("F1", SLOT_NR);
    return pred("F1", SLOT_C); // D-29
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
    const latest = posture === POSTURE_VL;
    const owned = c !== null && !(c._config & CONFIG_CHILDREN_FORBIDDEN);
    const tr = owned && tracked;
    if (laneNode && !(errored && !guess)) {
      // Vl5 (D-22 D-34): a guess is the value; a derivation the lane's
      // latest unless in flight, else its display. `isPending` reads the
      // display. The pass is the holder's verdict lane's (AH(parent)).
      const l = txOf(el);
      const flying = pending; // (quiet re-asks are the verdict's business, not the slot's)
      const parent = l._parent ?? l;
      if (guess)
        return pred(
          latest ? "Vl5" : "Vp1",
          latest && l.folded ? (staged ? SLOT_P : SLOT_C) : SLOT_LV,
          tr ? MARK_AH : 0,
          parent
        );
      return pred(
        latest ? "Vl5" : "Vp1",
        latest && !flying ? SLOT_LV : SLOT_DV,
        tr ? MARK_AH : 0,
        parent
      );
    }
    // (An error is thrown last, as `verdictValue` does: a held or staged
    // node answers through the rows above it, D-41.)
    if (held) {
      const t = txOf(el);
      if (!uninit) {
        // Vl1 (D-22 F-6): the proposal; `isPending`'s value is the screen's
        // (Vp1: "value as Vl" — see design doc §6, the slot is C today).
        if (latest && staged) {
          // Vl1' (#3460, as L7): a render effect outside the hold's own
          // flush while its verdict lane is blocked is a stale reader of
          // it — the screen now, re-derived at the reveal.
          if (
            tr &&
            (c as any)._type === EFFECT_RENDER &&
            !inLane &&
            !seat!.probed &&
            t._verdict?._held &&
            flushTransaction !== t
          )
            return pred("Vl1'", SLOT_C, MARK_ST, t);
          // The proposal — a staged error included (D-41: `staged` throws it).
          return pred("Vl1", stagedError ? SLOT_E : SLOT_P, tr ? MARK_AH : 0, t);
        }
        return pred(latest ? "Vl1" : "Vp1", SLOT_C, tr ? MARK_AH : 0, t);
      }
      // Born into the future: its staging is its only value (Vl4 b → P; Vp2:
      // owned, as a plain read — the owner joins the hold).
      if (staged && !pending)
        return pred(
          latest ? "Vl4" : "Vp2",
          stagedError ? SLOT_E : SLOT_P,
          owned && !latest ? RAISE_H : 0,
          t
        );
      return pred(latest ? "Vl4" : "Vp2", SLOT_NR, 0, t); // f0
    }
    if (staged) {
      // Vl2/Vl3 (D-22 D-32 F-10 [R5]): in a flush the staging — the seam's
      // verdict, no hold opened, W; outside a flush the committed value and
      // a late re-run. `isPending`: the screen.
      if (latest) {
        if (globalQueue._running)
          return pred("Vl2", stagedError ? SLOT_E : SLOT_P, tr ? MARK_W : 0, tickHold());
        return pred("Vl3", SLOT_C);
      }
      return pred("Vp1", SLOT_C, tr ? MARK_W : 0, tickHold());
    }
    if (pending) {
      if (uninit) return pred(latest ? "Vl4" : "Vp2", SLOT_NR); // f0: loading, not pending
      return pred(latest ? "Vl4" : "Vp1", SLOT_C); // f: below the async nothing newer exists
    }
    if (errored) return pred(latest ? "Vl4" : "Vp1", SLOT_E);
    return pred(latest ? "Vl4" : "Vp1", SLOT_C);
  }

  // ── Common arms for L / D / V / A-as-D ─────────────────────────────────
  const leaf = posture === POSTURE_L;
  const verdictReader = posture === POSTURE_V;
  const rowBase = posture === POSTURE_A ? "A1/" : "";

  // Lane node (CONFIG_OVERRIDE): the lane rows.
  if (laneNode && !(errored && !guess)) {
    const l = txOf(el);
    const flying = pending && !guess;
    const cUninit = (c!._statusFlags & STATUS_UNINITIALIZED) !== 0;
    const cHeldByFlush =
      (c!._config & CONFIG_HELD) !== 0 &&
      flushTransaction !== null &&
      resolveTx(flushTransaction) === txOf(c!);
    const renderLeaf = leaf || (verdictReader && (c as any)._type === EFFECT_RENDER);
    if (laneOf(l) === null) {
      // V6 (D-25 #4050): a verdict pass's derivation — today stored as a
      // verdict lane's value, at the swap a mainline memo. Reading it is
      // reading the memo: its value (Lv ≡ Dv here), NR while it flies; a
      // pass held by the flush's hold reads its staging (D-2).
      const never = flying && el._x!._lane === NOT_PENDING;
      if (renderLeaf) {
        // As L7 for a lane: a flight never shown waits; the flush's own
        // hold reads its staging; a held verdict lane or a flight shows the
        // display (NR for a leaf's first run over a lane never shown). A
        // pass already seated as the verdict's (probed) reads the value —
        // F-vlane: the old code's "same verdict lane" test, approximated.
        if (never && l._shown) return pred("V6", SLOT_NR, MARK_ST, l);
        if (!seat!.probed) {
          if (!guess && staged && cHeldByFlush) return pred("V6", SLOT_P);
          if (l._held || flying)
            return pred("V6", !l._shown && uninit ? SLOT_NR : SLOT_DV, MARK_ST, l);
        }
        return pred("V6", flying ? SLOT_NR : SLOT_LV, MARK_AH, l._parent);
      }
      // An untracked read outside lane work: the display (as D4'').
      if ((!tracked || posture === POSTURE_F) && !inLane && !seat!.probed)
        return pred("V6", SLOT_DV);
      if (flying) return pred("V6", SLOT_NR, MARK_AH, l._parent);
      return pred("V6", SLOT_LV, MARK_AH, l._parent);
    }
    // A folded lane (D-34): a deriving pass outside the lane reads the
    // hold's world and joins it; lane work and leaves keep the guess.
    if (l.folded && guess && !inLane && !leaf && (el as any)._host?.fam?.node !== c) {
      return pred(rowBase + "D4'", staged ? SLOT_P : SLOT_C, RAISE_H, resolveTx(l._parent ?? l));
    }
    if (!tracked && !inLane) return pred(rowBase + "D4''", SLOT_DV); // outside lane work, the screen
    // A derivation's flight is the lane's own (a guess's is its truth's: the
    // guess stands in for it, A17). V5 (D-28 #4284): a verdict reader that
    // is a render effect reads a lane as a leaf does.
    if (renderLeaf) {
      const never = flying && el._x!._lane === NOT_PENDING;
      const laneSeat = inLane ? seat!.lane : null;
      if (laneSeat === null || !sameLane(laneSeat, l)) {
        if (never && l._shown) return pred("L7", SLOT_NR, MARK_ST, l); // flight never shown: waits
        // L7' (D-2): a leaf the flush's hold holds reads a lane derivation's
        // staging — the hold's own value.
        if (!guess && staged && cHeldByFlush) return pred("L7'", SLOT_P);
        if (l._held || flying) {
          if (!guess && !l._shown && uninit) return pred("L7", SLOT_NR, MARK_ST, l);
          return pred("L7", SLOT_DV, MARK_ST, l); // D-26 D-28
        }
      }
      // D-26 D-37: the lane's value; a flight of the lane's own is the
      // lane's wait (NR: lane work throws on its own flights, D-37).
      return pred("L6", flying ? SLOT_NR : SLOT_LV, RAISE_LANE, null, l);
    }
    // D4 (D-37 D-25 [R4]): the lane's value, the pass enters the lane (links
    // if it already sits in another). A lane derivation in flight: the
    // pass has entered the lane and the flight is the lane's own — C
    // (D8's "pass has a value"), NR without one.
    // D4''' (D-37): the lane's own flight — lane work waits on it (NR).
    if (flying) return pred(rowBase + "D4'''", SLOT_NR, RAISE_LANE, null, l);
    return pred(rowBase + "D4", SLOT_LV, RAISE_LANE, null, l);
  }

  // Error (D-41).
  if (errored) return pred(leaf ? "L8" : rowBase + "D5", SLOT_E);

  // Held node.
  if (held) {
    const t = txOf(el);
    const own = t === flushTransaction || seatBornInto(seat, t);
    if (leaf) {
      // L4 (D-9 D-2): inputs published, or born — the leaf has no screen to
      // fall back to; the tick joins (D-4), the leaf's world does not move.
      if (uninit)
        return pred("L4", pending ? SLOT_NR : staged ? SLOT_P : SLOT_C, MARK_TICK | MARK_HOLD, t);
      if (cfg & CONFIG_INPUTS_PUBLISHED)
        return pred("L4", pending ? SLOT_NR : staged ? SLOT_P : SLOT_C, MARK_HOLD, t);
      if (inLane && !(c!._statusFlags & STATUS_UNINITIALIZED && pending))
        return pred("D6", SLOT_C, MARK_ST, t); // lane work: the screen (D-37)
      if (own) return pred("L2", pending ? SLOT_NR : staged ? SLOT_P : SLOT_C, MARK_HOLD, t); // D-3 D-2
      return pred("L3", SLOT_C, MARK_ST, t); // D-3 D-9 D-26
    }
    if (verdictReader) {
      // V1 (D-23 A10 [R7]): a verdict reader is a frame reader — the
      // screen, re-derived at the landing — unless born into t.
      if (seatBornInto(seat, t))
        return pred("V1'", pending ? SLOT_NR : staged ? SLOT_P : SLOT_C, RAISE_H, t);
      if (uninit) return pred("V1''", pending ? SLOT_NR : SLOT_P, RAISE_H, t); // no screen to serve
      return pred("V1", SLOT_C, MARK_ST | MARK_AH, t);
    }
    if (inLane) {
      // D6 (D-37): lane work reading a hold's node — the screen, re-derived
      // at that landing; a lane pass with no value yet over a flight enters.
      if (!(c!._statusFlags & STATUS_UNINITIALIZED && pending) && !uninit)
        return pred(rowBase + "D6", SLOT_C, MARK_ST, t);
      return pred(rowBase + "D6'", pending ? SLOT_NR : SLOT_P, RAISE_H, t);
    }
    // D2 (D-1 D-2 D-10): the pass derives from the hold.
    if (pending) return pred(rowBase + "D2'", SLOT_NR, RAISE_H, t);
    return pred(rowBase + "D2", staged ? (stagedError ? SLOT_E : SLOT_P) : SLOT_C, RAISE_H, t);
  }

  // Staged this flush, not held.
  if (staged) {
    if (unflushed(el) && !uninit) {
      // A28 / F-10: an unflushed write — the committed value now and a late
      // re-run in the flush that carries it (`markLateLinker`).
      return pred(leaf ? "L1'" : rowBase + "D1'", SLOT_C);
    }
    if (uninit && !pending && spectate) return pred("U2", SLOT_NR);
    // (F-vlane: a pass the verdict lane's node set seats, not a probe's
    // CONFIG_VERDICT, reads a staging as its base posture does today.)
    if (verdictReader && !uninit && c!._config & CONFIG_VERDICT) {
      // V2/V3 (D-23 D-32 [R5]): the screen once the tick has a hold, the
      // staging before (the seam's verdict).
      const h = tickHold();
      if (flushTransaction !== null && !seatBornInto(seat, flushTransaction))
        return pred("V2", SLOT_C, MARK_ST, flushTransaction);
      return pred("V3", stagedError ? SLOT_E : SLOT_P, RAISE_FL | MARK_W, h);
    }
    if (
      inLane &&
      seat!.lane!.folded &&
      flushTransaction !== null &&
      !seatBornInto(seat, flushTransaction) &&
      !uninit
    )
      return pred(rowBase + "D7'", SLOT_C, MARK_ST, flushTransaction); // folded lane work reads the screen (D-34)
    if (pending) {
      // A staging beneath a newer flight: the flight decides (D3 below); a
      // node with no committed value in flight has nothing to show (F-9).
    } else {
      const asLeaf = leaf || (verdictReader && (c as any)._type === EFFECT_RENDER);
      const row = asLeaf ? "L1" : inLane ? rowBase + "D7" : rowBase + "D1";
      // A pass reading a node born staged (uninitialized) has no screen to
      // re-derive on: no Fl mark (#3969), the value is still the staging's.
      const raise = uninit ? 0 : asLeaf ? MARK_SR : RAISE_FL | (inLane ? MARK_W : 0);
      return pred(row, stagedError ? SLOT_E : SLOT_P, raise, inLane ? seat!.lane : null);
    }
  }

  // A flight, not held.
  if (pending) {
    if (inLane && !(c!._statusFlags & STATUS_UNINITIALIZED)) return pred(rowBase + "D8", SLOT_C); // D-37: not the lane's own, the pass has a value
    if (verdictReader && !uninit) {
      // (F-vlane: a pass the verdict lane seats is lane work today — C.)
      if (cfg & CONFIG_INPUTS_PUBLISHED && !seat!.probed)
        return pred("V4'", SLOT_NR, 0, flushTransaction);
      return pred("V4", SLOT_C, MARK_ST | MARK_AH, flushTransaction); // D-23 D-9
    }
    return pred(leaf ? "L5" : rowBase + "D3", SLOT_NR); // F-2 D-28 / F-2 D-9
  }

  return pred(leaf ? "L0" : rowBase + "D0", SLOT_C); // committed only
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
      if (t._lane) bits.push(laneOf(t) === null ? "vlane" : "lane");
      if (t._shown) bits.push("shown");
      if (t._held) bits.push("lheld");
      if (t.folded) bits.push("folded");
    }
  }
  const seat = currentSeat();
  const cbits: string[] = [];
  if (c !== null && c._statusFlags & STATUS_UNINITIALIZED) cbits.push("cU");
  if (c !== null && (c as any)._type) cbits.push(`t${(c as any)._type}`);
  if (seat !== null && seat.node === c) {
    cbits.push(`w${seat.world}`);
    if (seat.lane !== null) cbits.push("inLane");
    if (seat.ahead) cbits.push("ahead");
  }
  cbits.push(laneOf(passLane) !== null ? "oldLane" : passLane !== null ? "oldVlane" : "oldNoLane");
  if (flushTransaction !== null) cbits.push("flushTx");
  else if (passTx !== null) cbits.push("passTx");
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
      detail
    };
    mismatches.set(key, m);
  }
  m.count++;
  const trace = (globalThis as any).__SEAT_SHADOW_TRACE__;
  if (trace && m.count <= 3 && (key.includes(trace) || row === trace))
    (globalThis as any).process?.stderr?.write(
      `[seat-shadow] ${key} reader ${m.reader} node ${m.node} trail ${currentSeat()?.trail.join(",")} probed ${currentSeat()?.probed}\n` +
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
} {
  return {
    reads,
    passes,
    orphanReads,
    rows: Object.fromEntries(rowHits),
    mismatches: [...mismatches.values()]
  };
}
export function shadowReset(): void {
  mismatches.clear();
  rowHits.clear();
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
  lane: Transaction | null = null
): void {
  if (readDepth >= 0 && frames[readDepth].c === c) return;
  const seat = currentSeat();
  if (seat === null || seat.node !== c) return;
  applyRaise(seat, pred("ext", raise, raise, null, lane));
  seat.trail.pop();
}

/** A boundary's display-ahead swap (`fallback`, #3540 #4337): the output's
 * pass is seated where the re-arm's `on` pass was — a lane's work, or a
 * verdict reader's (the `isPending`/`latest` the `on` read). */
export function shadowSwapSeat(out: Computed<any>, l: Transaction): void {
  shadowExternalRaise(out, laneOf(l) === null ? MARK_AH : RAISE_LANE, l);
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
  const seat = currentSeat();
  if (seat !== null && c !== null && seat.node === c) {
    // INV-seat-1: a leaf never raises its world.
    if (posture === POSTURE_L && p.raise & (RAISE_H | RAISE_FL))
      report("INV-seat-1", p.row, c, el, "a leaf's row raises its world", p.slot, actual);
    else applyRaise(seat, p);
    // World agreement — every posture but L: a leaf's JOINED is bookkeeping
    // today (D-3 says its world is the screen's; INV-seat-1), re-encoded at
    // the swap as the leaf clause of B2. The old world is the pass's flags
    // (wiped at the pass's head): JOINED is H, STAGED_READ is Fl.
    if (posture !== POSTURE_L && actual === p.slot) {
      const flagWorld =
        c._flags & REACTIVE_JOINED ? WORLD_H : c._flags & REACTIVE_STAGED_READ ? WORLD_FL : WORLD_S;
      const oldWorld = flagWorld > seat.openWorld ? flagWorld : seat.openWorld;
      if (oldWorld !== seat.world)
        report(
          "INV-seat-3",
          p.row,
          c,
          el,
          `world after the read (old ${oldWorld}, new ${seat.world}; ${POSTURE_NAMES[posture]} posture)`,
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
  // INV-seat-2: posture is the node's own.
  if (seat.posture !== postureOf(el, 0))
    report("INV-seat-2", "B1", el, null, "posture inherited", 0, 0);
  // Old "ahead" for a first pass: the mount (creator's lane or its mount's),
  // or a creator that had joined.
  if (create) {
    const oldAhead = !!mount;
    if (oldAhead !== seat.ahead && !(creatorJoined && seat.world === WORLD_H))
      report(
        "INV-seat-3",
        "B1",
        el,
        null,
        `ahead (old ${oldAhead}, new ${seat.ahead}; creator running ${seat.creatorRunning}, creator ${nameOf(creator)})`,
        0,
        0
      );
    if (creatorJoined && seat.world < WORLD_H && !mount)
      report("INV-seat-3", "B1", el, null, "inherited world (old creator JOINED, new < H)", 0, 0);
  }
  return seat;
}

/** `recompute`'s finally: the born-held decision beside the old one. */
export function shadowSeatClose(
  el: Computed<any>,
  isEffect: boolean,
  oldJoined: boolean,
  oldCreatorJoined: boolean,
  oldMount: unknown
): void {
  const seat = currentSeat();
  if (seat === null || seat.node !== el) {
    report("INV-seat", "B2", el, null, "no seat open for the pass", 0, 0);
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
  // (A pass a verdict lane seats publishes as lane work today: the born-held
  // arm is not reached — the shadow compares only where it is.)
  if (seat.create && seat.lane === null && passLane === null) {
    const pending = (el._statusFlags & STATUS_PENDING) !== 0;
    const tick = flushTransaction !== null || passTx !== null;
    const oldBorn = tick && (oldJoined || oldCreatorJoined);
    const newBorn = bornHeld(seat, isEffect, pending);
    if (oldBorn !== newBorn)
      report(
        "INV-seat-3",
        "B2",
        el,
        null,
        `born held (old ${oldBorn}, new ${newBorn}; world ${seat.world}, ahead ${seat.ahead}, mount ${!!oldMount}, pending ${pending}, rows ${seat.trail.slice(-4).join(",")})`,
        0,
        0
      );
  }
  // (A boundary's output sets its own CONFIG_FRAME at the head of its body,
  // and a probe sets CONFIG_VERDICT: the node's own transitions.)
  const probed = seat.probed;
  seat.probed = false;
  const posture = postureOf(el, 0);
  seat.probed = probed;
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
