/**
 * #4569 (ruled 2026-10-31, today's behaviour; D-23, F-9, S-40; #3373, #4459, #4495): a first
 * load under `Loading` whose chain is re-asked upstream while its own first
 * flight is still up.
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
 * Ruling: a node's question changes only when the node itself re-runs
 * (#3373: "nothing superseded it") — pending by propagation changed `a0`'s
 * status, not `a2`'s inputs — so `a2:11` is the current answer. It lands
 * (`landStatus` retires the self entry only), initializes `a2`, and `a2` is
 * committed-and-pending on `a0`'s flight. Content that reads only its verdict
 * reveals when the verdict exists (S-40: a fresh boundary reading only a
 * display-ahead channel shows what it has); content that reads `a2` holds
 * until the chain settles — a first reveal has no screen to keep (F-2). That
 * asymmetry is the rule, not a bug.
 *     loading, loading, loading, pending, pending, settled
 *
 * Crux, as ruled: does an upstream re-ask that marks a node pending by
 * propagation change the node's question before the node re-runs? No.
 *
 * Rejected reading: the answer is to a superseded world; a first load
 * stays loading until the chain settles (`loading ×5, settled`). Rejected: it
 * needs a "supersession by propagation" no rule has and a new resting state
 * (staged, uninitialized, pending, unheld), treats an uninitialized node more
 * strictly than a committed one (#3373 writes the same landing), and
 * contradicts #4459/#4495, where a node — and an identity memo over it, with
 * no value of its own, pending by propagation — is initialized by an answer
 * to a re-asked question and a fresh boundary's first reveal is `p:true`.
 *
 * Controls: a plain read `a2()` under the same boundary — alone, or beside
 * the probe (D-23's canonical form) — waits on the pending `a2` (`read`: a
 * reader with no screen to keep) and the boundary holds to the chain's end.
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
  frames.push(shown()); // a2:11 lands on the uninitialized a2: committed, pending on a0
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

describe("#4569 a first load answered while pending by propagation is committed and pending", () => {
  describe("under Loading (the issue's shape)", () => {
    it("the answer initializes a2; the verdict-only content reveals with `pending` (S-40, D-23)", async () => {
      expect(await run("boundary")).toEqual([L, L, L, "pending", "pending", "settled"]);
    });
    // Rejected reading, for the record: `[L, L, L, L, L, "settled"]` — a
    // first load stays loading until the chain settles. See the header.
  });

  describe("3-deep chain (a0 → a1 → a2), a1 has a value when a0 is re-asked", () => {
    it("the same: a2:13 initializes a2; reveals `pending`", async () => {
      expect(await run("boundary-3-deep")).toEqual([L, L, L, "pending", "pending", "settled"]);
    });
  });

  describe("controls: a plain read of a2 under the boundary holds (F-2, no screen to keep)", () => {
    it("`{a2()}` alone: the reader waits on the pending a2; the boundary holds to the end", async () => {
      expect(await run("boundary-plain")).toEqual([L, L, L, L, L, "a2=21"]);
    });
    it("`{a2()} {isPending(a2)}` (D-23's canonical form): the same hold; first frame `settled`", async () => {
      expect(await run("boundary-both")).toEqual([L, L, L, L, L, "a2=21 settled"]);
    });
  });

  describe("no boundary: isPending(() => a2()) in a root (D-6 holds the attach)", () => {
    const U = "(unattached)";
    it("the answer attaches the root with `pending`", async () => {
      expect(await run("root")).toEqual([U, U, U, "pending", "pending", "settled"]);
    });
  });
});
