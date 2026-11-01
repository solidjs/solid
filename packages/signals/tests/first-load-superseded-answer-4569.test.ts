/**
 * #4569 (F-9, D-22, D-23): a first load under `Loading` whose chain is re-asked
 * upstream while its own first flight is still up. Pinned at BOTH candidate
 * screens; the maintainer rules.
 *
 *   a0 = createMemo(() => ask("a0:" + s()))
 *   a2 = createMemo(async () => ask("a2:" + (await a0())))
 *   <Loading fallback="loading">{isPending(() => a2()) ? "pending" : "settled"}</Loading>
 *
 * Timeline: `a0:0` lands (11) → `a2` asks `a2:11`; `setS(1)` re-asks `a0:1`,
 * which marks `a2` pending BY PROPAGATION while `a2:11` is still in flight and
 * `a2` has no committed value; `a2:11` lands (16); `a0:1` lands (20) → `a2`
 * re-runs and asks `a2:20`; it lands (21).
 *
 * R2 — today / the letter of #3373 and #4459 ("one question per node"):
 *   `a2`'s question is still "given a0 = 11" until `a0` delivers a new value —
 *   pending-by-propagation changed `a0`'s status, not `a2`'s inputs — so
 *   `a2:11` is the current answer to the current question. It lands
 *   (`landStatus` retires the self entry only, #3373), `a2` initializes, and
 *   stays pending on `a0`. The boundary now has a reader with a value and a
 *   verdict (D-23 cause ii, read through `a0`'s flight), so it reveals:
 *     loading, loading, loading, pending, pending, settled
 *   F-9 Exception 1 is satisfied in letter: the node has a committed value.
 *
 * R1 — the reporter: an answer landing after the node was marked pending by
 *   an upstream re-ask answers a superseded world. On a first load it must
 *   not initialize the node: "a first load is loading, not pending", and
 *   `isPending` "cannot be true on creation" (F-9). The boundary holds until
 *   the chain settles and its first frame has no pending verdict:
 *     loading, loading, loading, loading, loading, settled
 *   No rule text today speaks of supersession BY PROPAGATION (vs. by the
 *   node's own re-run); R1 would add it, scoped to uninitialized nodes. It
 *   must be scoped in TIME as well: #4459 (D-22/D-23 amended 2026-10-30)
 *   pins a boundary's first reveal at `p:true` for a node — and an identity
 *   memo over it, with no value of its own, pending by propagation — whose
 *   only committed value answers the question a write re-asked in the same
 *   flush. R1 survives #4459 only as "an answer RESOLVED after the flush that
 *   marked the node pending by propagation initializes no first load";
 *   #4459's answers resolved before their write (answered, then re-asked).
 *
 * Crux: does an upstream re-ask that marks a node pending by propagation
 * change the node's question before the node itself re-runs — so that an
 * answer resolved after that flush is to no current question and cannot
 * initialize a first load (R1) — or does a node's question change only when
 * the node re-runs (#3373: "nothing superseded it"), making the answer
 * current (R2)?
 *
 * Only the `a2`-has-no-value case is at issue: with a committed value the same
 * landing is #3373/#3376's ("the landed value is still written and held",
 * `isPending` stays true), which neither reading disturbs.
 *
 * Controls (undisputed, today): a plain read `a2()` under the same boundary —
 * alone, or beside the probe (D-23's canonical form) — throws on the pending
 * `a2` (`read`: a reader with no screen to keep waits on the flight) and the
 * boundary holds to the chain's end: R1's frames. Only the probe-alone content
 * reveals at `a2:11`: `pendingVerdict` answers `true` for a node with a
 * committed value and does not throw, so the reader completes and `prune`
 * finds nothing pending under the boundary (`boundaries.ts`).
 */
import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Shape = "boundary" | "root" | "boundary-3-deep" | "boundary-plain" | "boundary-both";

/** Runs the issue's timeline; returns one frame per step (6 frames). */
async function run(shape: Shape) {
  const flights = new Map<string, (v: number) => void>();
  const ask = (key: string) => new Promise<number>(resolve => flights.set(key, resolve));
  const land = (key: string, v: number) => {
    const r = flights.get(key);
    if (!r) throw new Error(`no flight ${key}; have ${[...flights.keys()].join(",")}`);
    r(v);
  };
  const [s, setS] = createSignal(0);
  let leaf = "";
  let output: string | undefined;
  const frames: string[] = [];
  const dispose = createRoot(dispose => {
    const a0 = createMemo(() => ask("a0:" + s()));
    const a1 = shape === "boundary-3-deep" ? createMemo(async () => ask("a1:" + (await a0()))) : a0;
    const a2 = createMemo(async () => ask("a2:" + (await a1())));
    const verdict = () => (isPending(() => a2()) ? "pending" : "settled");
    const probe =
      shape === "boundary-plain"
        ? () => `a2=${a2()}`
        : shape === "boundary-both"
          ? () => `a2=${a2()} ${verdict()}`
          : verdict;
    if (shape === "root") {
      // No boundary: a first load holds the root attach (D-6).
      createRenderEffect(probe, v => void (output = v));
    } else {
      const b = createLoadingBoundary(
        () => {
          createRenderEffect(probe, v => void (leaf = v));
          return "content";
        },
        () => "loading"
      );
      createRenderEffect(b, v => void (output = v));
    }
    return dispose;
  });
  const shown = () =>
    shape === "root" ? (output ?? "(unattached)") : output === "content" ? leaf : output!;
  flush();
  await tick();
  frames.push(shown());
  land("a0:0", 11);
  await tick();
  frames.push(shown()); // 2-deep: asks a2:11; 3-deep: asks a1:11
  if (shape === "boundary-3-deep") {
    land("a1:11", 13);
    await tick(); // asks a2:13
  }
  setS(1);
  flush();
  await tick();
  frames.push(shown()); // re-asks a0:1; a2 (no value, own flight up) is pending by propagation
  land(shape === "boundary-3-deep" ? "a2:13" : "a2:11", 16);
  await tick();
  frames.push(shown()); // an answer to the old question lands on an uninitialized a2
  land("a0:1", 20);
  await tick();
  if (shape === "boundary-3-deep") {
    land("a1:20", 22);
    await tick();
  }
  frames.push(shown()); // re-asks a2:20 / a2:22
  land(shape === "boundary-3-deep" ? "a2:22" : "a2:20", 21);
  await tick();
  frames.push(shown());
  dispose();
  return frames;
}

const L = "loading";

describe("#4569 a first load's answer to a superseded upstream question", () => {
  describe("under Loading (the issue's shape)", () => {
    it("today / R2: the old answer initializes a2; the boundary reveals with `pending`", async () => {
      expect(await run("boundary")).toEqual([L, L, L, "pending", "pending", "settled"]);
    });
    it.fails(
      "R1: a first load stays loading until the chain settles; first frame `settled`",
      async () => {
        expect(await run("boundary")).toEqual([L, L, L, L, L, "settled"]);
      }
    );
  });

  describe("3-deep chain (a0 → a1 → a2), a1 has a value when a0 is re-asked", () => {
    it("today / R2: same shape — a2:13 initializes a2; reveals `pending`", async () => {
      expect(await run("boundary-3-deep")).toEqual([L, L, L, "pending", "pending", "settled"]);
    });
    it.fails("R1: the boundary holds until a2 answers the current world", async () => {
      expect(await run("boundary-3-deep")).toEqual([L, L, L, L, L, "settled"]);
    });
  });

  describe("controls: a plain read of a2 under the boundary (undisputed today)", () => {
    it("`{a2()}` alone: the reader waits on the pending a2; the boundary holds to the end", async () => {
      expect(await run("boundary-plain")).toEqual([L, L, L, L, L, "a2=21"]);
    });
    it("`{a2()} {isPending(a2)}` (D-23's canonical form): the same hold; first frame `settled`", async () => {
      expect(await run("boundary-both")).toEqual([L, L, L, L, L, "a2=21 settled"]);
    });
  });

  describe("no boundary: isPending(() => a2()) in a root (D-6 holds the attach)", () => {
    const U = "(unattached)";
    it("today / R2: the old answer attaches the root with `pending`", async () => {
      expect(await run("root")).toEqual([U, U, U, "pending", "pending", "settled"]);
    });
    it.fails("R1: the attach waits for the chain; first frame `settled`", async () => {
      expect(await run("root")).toEqual([U, U, U, U, U, "settled"]);
    });
  });
});
