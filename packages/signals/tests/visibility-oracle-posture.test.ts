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
 *
 * Readers under a posture: untracked, memo (its pass value and what a render
 * effect over it publishes), latest, isPending.
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
import { STATES } from "./visibility-oracle.states.js";

const POSTURES = [
  "mainline",
  "foreignAction",
  "foreignLane",
  "behindFallback",
  "disposedReader"
] as const;
type Posture = (typeof POSTURES)[number];
const READERS = ["untracked", "memo", "latest", "isPending"] as const;
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
  if (posture === "mainline" || posture === "disposedReader") {
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
    flush();
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

type Row = {
  state: string;
  posture: Posture;
  reader: Reader;
  served: Cell;
  passValue?: Cell; // memo: what its pass read
  afterSourceRelease: Cell; // untracked x() after ONLY the source's holds are released
  foreignStillHeld: boolean | null; // y() still 0 (the foreign action did not settle)
};
const rows: Row[] = [];

async function cell(state: State, posture: Posture, reader: Reader): Promise<Row> {
  const built = state.build(() => {});
  const { x, dispose } = built instanceof Promise ? await built : built;
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
      }
    }
  });
  flush();
  if (reader === "memo") {
    served = log.length ? log[log.length - 1] : HELD;
    passValue = pass.length ? pass[pass.length - 1] : HELD;
  }
  if (posture === "disposedReader") {
    for (const d of disposers.splice(0)) d();
    flush();
  }
  // Entanglement probe: release ONLY the source's holds.
  for (const r of holds.splice(0, sourceHolds)) r();
  await settle();
  await settle();
  const afterSourceRelease = classify(x);
  const foreignStillHeld = y ? y() === 0 : null;
  dispose();
  await releaseAll();
  for (const d of disposers.splice(0)) d();
  flush();
  return {
    state: state.name,
    posture,
    reader,
    served,
    passValue,
    afterSourceRelease,
    foreignStillHeld
  };
}

const fmt = (c: Cell | undefined) => (c === undefined ? "" : c === HELD ? "HELD" : String(c));

describe("visibility oracle — posture matrix (discovery)", () => {
  for (const state of STATES)
    for (const posture of POSTURES)
      for (const reader of READERS)
        it(`${state.name} × ${posture} × ${reader}`, async () => {
          rows.push(await cell(state, posture, reader));
          expect(true).toBe(true);
        });
  afterAll(() => {
    const out: string[] = ["# visibility oracle — posture matrix (discovery, no pins)", ""];
    for (const state of STATES) {
      out.push(`## ${state.name}`, "");
      out.push(
        "| reader | posture | served | memo pass | x after source release | foreign still held |"
      );
      out.push("|---|---|---|---|---|---|");
      for (const reader of READERS) {
        const base = rows.find(
          r => r.state === state.name && r.reader === reader && r.posture === "mainline"
        );
        for (const posture of POSTURES) {
          const r = rows.find(
            r => r.state === state.name && r.reader === reader && r.posture === posture
          )!;
          const entangled =
            base &&
            posture !== "mainline" &&
            fmt(r.afterSourceRelease) !== fmt(base.afterSourceRelease);
          const servedDiff = base && posture !== "mainline" && fmt(r.served) !== fmt(base.served);
          out.push(
            `| ${reader} | ${posture} | ${fmt(r.served)}${servedDiff ? " **≠**" : ""} | ${fmt(r.passValue)} | ${fmt(r.afterSourceRelease)}${entangled ? " **ENTANGLED**" : ""} | ${r.foreignStillHeld === null ? "—" : r.foreignStillHeld} |`
          );
        }
      }
      out.push("");
    }
    const path = process.env.VISIBILITY_POSTURE_REPORT;
    if (path) require("node:fs").writeFileSync(path, out.join("\n") + "\n");
  });
});
