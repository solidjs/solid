/**
 * Visibility oracle — posture matrix (DISCOVERY MODE).
 *
 * The visibility oracle pins node state × reader KIND with every reader built
 * mainline. This file adds the reader's POSTURE — where the reader lives when
 * it is built — and a second observable, ENTANGLEMENT: after the reader is
 * built, only the SOURCE's hold is released; does `x` reveal, or is its reveal
 * now blocked by the reader's own context (a transaction merge, a batch
 * adoption, a lane)?
 *
 * Postures:
 * - mainline       the reader is built in the imperative scope (the oracle's rows)
 * - foreignAction  the reader is built inside ANOTHER live action's body; that
 *                  action also writes its own unrelated signal `y` and yields
 *                  forever
 * - foreignLane    as foreignAction, and the foreign action first writes its own
 *                  createOptimistic (`setO(9)`) so the reader runs under a lane
 *                  that is not the source's
 * - behindFallback the reader is built inside a createLoadingBoundary whose
 *                  content is pending on a sibling flight that never lands —
 *                  the fallback is showing, the reader is not on screen
 * - disposedReader the reader is built mainline and its root is DISPOSED
 *                  before the source's hold is released — a dead reporter
 * - gatedAway      the memo reader is built mainline behind a `show()` gate,
 *                  then the gate closes: the reader is ALIVE but no longer
 *                  derives from `x`. Records `x`, `isPending(x)` and the
 *                  state's held SOURCE write after the gate closes, before
 *                  any release — a reader that stopped reading the flight
 *                  must not keep its hold (fuzzer #3446 P1, 2026-09-15)
 *
 * Readers under a posture: untracked, memo (its pass value and what a render
 * effect over it publishes), effect (a render effect reading `x` DIRECTLY —
 * the reporter shape the fuzzer's P1 reduction used), latest, isPending.
 *
 * This is the discovery pass: no cell is pinned. Every cell is recorded to
 * VISIBILITY_POSTURE_REPORT (a markdown table per state) so red cells can be
 * brought to a ruling before anything is written against them.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createLoadingBoundary,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  NotReadyError
} from "../src/index.js";
import {
  HELD,
  holds,
  never,
  releaseAll,
  settle,
  type Cell,
  type State
} from "./visibility-oracle.harness.js";
import { STATES as ORACLE_STATES } from "./visibility-oracle.states.js";
import { STATES as STORE_STATES } from "./visibility-oracle-store.states.js";

/** Matrix-only states (no reader-kind expectations): shapes whose question is
 * the READER's hold rather than the served value. */
const MATRIX_STATES: State[] = [
  {
    // Fuzzer #3446 P1 (case 854, reduced): the matrix reader is the flight's
    // ONLY observer; the source is written while it observes (perturb); then
    // the reader gates away. Nothing visible still needs the unresolved
    // answer — does the ordinary write publish? (`source` after the gate.)
    name: "pending own async, observed only by the matrix reader (fuzzer P1)",
    build() {
      const [q, setQ] = createSignal(0);
      let x!: () => unknown;
      const dispose = createRoot(d => {
        x = createMemo(() => {
          q();
          return new Promise<number>(() => {}); // never lands
        });
        return d;
      });
      // No flush here: the memo's first computation happens under the matrix
      // reader's observation (the fuzzer's schedule), not swept dormant first.
      return { x, dispose, source: q, perturb: () => setQ(1) };
    },
    expect: {} as State["expect"]
  }
];
const STATES = [...ORACLE_STATES, ...STORE_STATES, ...MATRIX_STATES];

const POSTURES = [
  "mainline",
  "foreignAction",
  "foreignLane",
  "behindFallback",
  "disposedReader",
  "gatedAway"
] as const;
type Posture = (typeof POSTURES)[number];
const READERS = ["untracked", "memo", "effect", "latest", "isPending"] as const;
type Reader = (typeof READERS)[number];

const classify = (fn: () => unknown): Cell => {
  try {
    return fn();
  } catch (e) {
    return e instanceof NotReadyError
      ? "throws:NotReady"
      : `throws:${(e as Error)?.constructor?.name ?? String(e)}`;
  }
};

/** Run `build` in the posture's context. Returns the foreign signal `y`'s
 * accessor (null for mainline) so the probe can confirm the foreign action is
 * still live after the source's hold is released. */
function enter(posture: Posture, build: () => void): { y: (() => number) | null } {
  if (posture === "mainline" || posture === "disposedReader" || posture === "gatedAway") {
    build();
    return { y: null };
  }
  if (posture === "behindFallback") {
    let view: unknown;
    const dispose = createRoot(d => {
      const blocker = createMemo(() => never());
      const b = createLoadingBoundary(
        () => {
          build();
          blocker(); // suspends the content: the fallback shows
          return "content";
        },
        () => "fallback"
      );
      createRenderEffect(b, v => {
        view = v;
      });
      return d;
    });
    disposers.push(dispose);
    gflush();
    if (view !== "fallback")
      throw new Error("behindFallback posture: fallback not showing (" + String(view) + ")");
    return { y: null };
  }
  const [y, setY] = createSignal(0);
  let setO: ((v: number) => void) | null = null;
  const dispose = createRoot(d => {
    if (posture === "foreignLane") [, setO] = createOptimistic(0);
    return d;
  });
  disposers.push(dispose);
  const run = action(function* () {
    setY(1);
    if (setO) setO(9);
    build();
    yield never();
  });
  run();
  return { y };
}
const disposers: Array<() => void> = [];

/** Discovery mode must not die on a __TEST__ invariant: record the first
 * INVARIANT_VIOLATION a step raises for the cell's `invariant` column and let
 * the runtime recover. (A stale companion left by an earlier cell can trip
 * the quiescence check at a later cell's first flush — attribution is by
 * cell order, and the dedicated pins name the bug precisely.) */
let cellInvariant: string | undefined;
function guard<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (!m.startsWith("[INVARIANT_VIOLATION]")) throw e;
    cellInvariant ??= m.slice(
      "[INVARIANT_VIOLATION] ".length,
      "[INVARIANT_VIOLATION] ".length + 60
    );
    return undefined;
  }
}
const gflush = () => guard(flush);
const gsettle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  gflush();
};

type Row = {
  state: string;
  posture: Posture;
  reader: Reader;
  served: Cell;
  passValue?: Cell; // memo: what its pass read
  afterSourceRelease: Cell; // untracked x() after ONLY the source's holds are released
  foreignStillHeld: boolean | null; // y() still 0 (the foreign action did not settle)
  afterGate?: string; // gatedAway: `x / source / isPending` after the gate closes, before any release
  invariant?: string; // an INVARIANT_VIOLATION raised by this cell's own quiescence (attributed here, not to the next cell)
};
const rows: Row[] = [];

async function cell(state: State, posture: Posture, reader: Reader): Promise<Row> {
  cellInvariant = undefined;
  const built = state.build(() => {});
  const { x, dispose, source, perturb } = built instanceof Promise ? await built : built;
  const [show, setShow] = createSignal(true);
  const gated = posture === "gatedAway";
  const sourceHolds = holds.length; // everything pushed so far belongs to the source
  let served: Cell = HELD;
  let passValue: Cell | undefined;
  const log: Cell[] = [];
  const pass: Cell[] = [];
  const { y } = enter(posture, () => {
    switch (reader) {
      case "untracked":
        served = classify(x);
        break;
      case "latest":
        served = classify(() => latest(x));
        break;
      case "isPending":
        served = classify(() => isPending(x));
        break;
      case "memo": {
        const d = createRoot(d => {
          const m = createMemo(() => {
            if (gated && !show()) return "gated";
            let v: Cell;
            try {
              v = x();
            } catch (e) {
              pass.push(
                e instanceof NotReadyError
                  ? "throws:NotReady"
                  : `throws:${(e as Error)?.constructor?.name}`
              );
              throw e;
            }
            pass.push(v);
            return v;
          });
          createRenderEffect(m, v => {
            log.push(v);
          });
          return d;
        });
        disposers.push(d);
        break;
      }
      case "effect": {
        const d = createRoot(d => {
          createRenderEffect(
            () => {
              if (gated && !show()) return "gated";
              let v: Cell;
              try {
                v = x();
              } catch (e) {
                pass.push(
                  e instanceof NotReadyError
                    ? "throws:NotReady"
                    : `throws:${(e as Error)?.constructor?.name}`
                );
                throw e;
              }
              pass.push(v);
              return v;
            },
            v => {
              log.push(v as Cell);
            }
          );
          return d;
        });
        disposers.push(d);
      }
    }
  });
  gflush();
  if (perturb) {
    perturb(); // the write the reader's hold is about, made while it observes
    gflush();
  }
  if (reader === "memo" || reader === "effect") {
    served = log.length ? log[log.length - 1] : HELD;
    passValue = pass.length ? pass[pass.length - 1] : HELD;
  }
  // Freeze the served value HERE: the closure readers (untracked / latest /
  // isPending) assign `served` inside the posture's own compute (boundary
  // content), which may re-run after the probes below change the world — a
  // later pass must not overwrite what the reader saw at build time.
  const servedAtBuild = served;
  let afterGate: string | undefined;
  if (gated) {
    setShow(false);
    gflush();
    await gsettle();
    afterGate = `${fmt(classify(x))} / ${source ? fmt(classify(source)) : "—"} / ${fmt(classify(() => isPending(x)))}`;
  }
  if (posture === "disposedReader") {
    for (const d of disposers.splice(0)) d();
    gflush();
  }
  // Entanglement probe: release ONLY the source's holds.
  for (const r of holds.splice(0, sourceHolds)) r();
  await gsettle();
  await gsettle();
  const afterSourceRelease = classify(x);
  const foreignStillHeld = y ? y() === 0 : null;
  dispose();
  for (const r of holds.splice(0)) r();
  await gsettle();
  await gsettle();
  for (const d of disposers.splice(0)) d();
  gflush();
  // Force this cell's quiescence check now (it runs only on a flush with no
  // parked transaction): an unrelated write, then a synchronous flush.
  const [, poke] = createSignal(0);
  poke(1);
  gflush();
  const invariant = cellInvariant;
  cellInvariant = undefined;
  return {
    state: state.name,
    posture,
    reader,
    served: servedAtBuild,
    passValue,
    afterSourceRelease,
    foreignStillHeld,
    afterGate,
    invariant
  };
}

const fmt = (c: Cell | undefined) => (c === undefined ? "" : c === HELD ? "HELD" : String(c));

describe("visibility oracle — posture matrix (discovery)", () => {
  for (const state of STATES)
    for (const posture of POSTURES)
      for (const reader of READERS) {
        if (posture === "gatedAway" && reader !== "memo" && reader !== "effect") continue; // a gate needs a tracked reader
        // INV-4 (spec O5, pinned it.fails in posture-store-parity.test.ts): a
        // projection leaf's latest() shadow is stale on the flush right after
        // its root is disposed. Under __TEST__ the runtime's own scheduled
        // flush throws and the scheduler is left mid-flush, poisoning every
        // later cell. Excluded until fixed; the pin names the bug.
        if (posture === "gatedAway" && state.name.startsWith("derived store (projection)"))
          continue;
        it(`${state.name} × ${posture} × ${reader}`, async () => {
          rows.push(await cell(state, posture, reader));
          expect(true).toBe(true);
        });
      }
  afterAll(() => {
    const out: string[] = ["# visibility oracle — posture matrix (discovery, no pins)", ""];
    for (const state of STATES) {
      out.push(`## ${state.name}`, "");
      out.push(
        "| reader | posture | served | memo pass | x after source release | foreign still held | after gate (x / source / isPending) | invariant |"
      );
      out.push("|---|---|---|---|---|---|---|---|");
      for (const reader of READERS) {
        const base = rows.find(
          r => r.state === state.name && r.reader === reader && r.posture === "mainline"
        );
        for (const posture of POSTURES) {
          const r = rows.find(
            r => r.state === state.name && r.reader === reader && r.posture === posture
          );
          if (!r) continue;
          const entangled =
            base &&
            posture !== "mainline" &&
            fmt(r.afterSourceRelease) !== fmt(base.afterSourceRelease);
          const servedDiff = base && posture !== "mainline" && fmt(r.served) !== fmt(base.served);
          out.push(
            `| ${reader} | ${posture} | ${fmt(r.served)}${servedDiff ? " **≠**" : ""} | ${fmt(r.passValue)} | ${fmt(r.afterSourceRelease)}${entangled ? " **ENTANGLED**" : ""} | ${r.foreignStillHeld === null ? "—" : r.foreignStillHeld} | ${r.afterGate ?? "—"} | ${r.invariant ? "**" + r.invariant + "**" : "—"} |`
          );
        }
      }
      out.push("");
    }
    const path = process.env.VISIBILITY_POSTURE_REPORT;
    if (path) require("node:fs").writeFileSync(path, out.join("\n") + "\n");
  });
});
