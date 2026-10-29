// R5 (#4393) with two `latest()` async readers under one async memo:
// `m0 = 1 + 10*latest(s) + s()`, `m0b = 100*(10*latest(t) + t())`,
// `m1 = m0() + m0b()`, every question distinct. `s` is written, and `t`
// 0–12 ms later, while the s flush is parked.
//
// - A frame whose transaction lands at the seam that would re-derive its
//   `latest()` reader in the verdict lane has nothing to re-derive: the pass
//   was the landing's, its flight the screen's answer (it asked m0b's frame
//   question twice in one flush).
// - `m1`'s verdict-lane pass that read a staging re-derives on the committed
//   world only while the transaction holding that staging stays parked — the
//   flush's, not the lane's parent — and not when the pass itself is all
//   that keeps it parked (lanes.ts `laneSeams`, `heldBy`): that transaction
//   lands with the pass's answer. Re-derived, it asked `m1:22` (or `m1:1122`)
//   a second time, and showed `m1` over `m0b = 0` beside `m0b = 1100`.
// - #4400's "m0:5 asked twice" is a number collision under `1 + latest(s) +
//   s()`: the lane question for s=3 and the frame question for s=2 are both
//   5. With a distinct encoding each question is asked once.
import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(15);
    flush();
  }
}

type Reader = "pair" | "split" | "value" | "screen" | "beside";

async function run(reader: Reader, gap: number) {
  const [s, setS] = createSignal(1);
  const [t, setT] = createSignal(0);
  const asks: string[] = [];
  const out: string[] = [];
  const ask = (n: string, v: number) => {
    asks.push(`${n}:${v}`);
    return sleep(10).then(() => v);
  };
  const show = (v: string) => void out.push(v);
  const dispose = createRoot(dispose => {
    const m0 = createMemo(() => ask("m0", 1 + 10 * latest(s) + s()));
    const m0b = createMemo(() => ask("m0b", 100 * (10 * latest(t) + t())));
    const m1 = createMemo(() => ask("m1", m0() + m0b()));
    const m2 = createMemo(() => m0b() + 1);
    createLoadingBoundary(
      () => {
        if (reader === "pair") createRenderEffect(() => `${isPending(m1)},v${m1()}`, show);
        else if (reader === "split") {
          createRenderEffect(() => `p${isPending(m1)}`, show);
          createRenderEffect(() => `v${m1()}`, show);
        } else createRenderEffect(() => `v${m1()}`, show);
        if (reader === "screen") {
          createRenderEffect(() => `t${t()}`, show);
          createRenderEffect(() => `b${m0b()}`, show);
        }
        if (reader === "beside") createRenderEffect(() => `c${latest(m2)}`, show);
        return null;
      },
      () => "L"
    );
    return dispose;
  });
  flush();
  await settle();
  asks.length = 0;
  out.length = 0;
  setS(2);
  flush();
  await sleep(gap);
  flush();
  setT(1);
  flush();
  for (let i = 0; i < 4; i++) await settle();
  dispose();
  const values = out.map(v => v.match(/v(\d+)/)?.[1]).filter(v => v !== undefined);
  return { asks, out, values };
}

describe("#4393: two latest() readers under one async memo, t written during the hold", () => {
  for (const reader of ["pair", "split", "value", "screen"] as const)
    for (const gap of [0, 3, 12])
      it(`each question asked once (${reader}, ${gap} ms)`, async () => {
        const { asks, values } = await run(reader, gap);
        expect(new Set(asks).size, asks.join(" ")).toBe(asks.length);
        expect(values.at(-1)).toBe("1123");
      });

  for (const gap of [0, 3, 12])
    it(`no m1 over t = 0 once t1 is shown (${gap} ms)`, async () => {
      const { out } = await run("screen", gap);
      const at = out.indexOf("t1");
      expect(at, out.join(" ")).not.toBe(-1);
      expect(
        out.slice(at).filter(v => v === "v1022" || v === "v1023"),
        out.join(" ")
      ).toEqual([]);
    });

  // m0b's answer to t=1 lands into a transaction parked only by m1's lane
  // pass (the render effect reading m1): that pass derives from it, and
  // its answer shows with it.
  it.each(["value", "beside"] as const)(
    "m1's lane pass is not re-derived over a staging that lands with it (%s)",
    async reader => {
      const { asks, out, values } = await run(reader, 12);
      expect(new Set(asks).size, asks.join(" ")).toBe(asks.length);
      expect(asks.slice(-2)).toEqual(["m1:1122", "m1:1123"]);
      expect(values).toEqual(["1122", "1123"]);
      if (reader === "beside") {
        const shown = out.indexOf("c1101");
        expect(out.indexOf("v1122"), out.join(" ")).toBeLessThan(shown);
        expect(out.slice(shown).filter(v => v[0] === "v")).toEqual(["v1123"]);
      }
    }
  );

  // Its lane's own render effect shows m1 (pair): the staging's transaction
  // lands at the very seam, so the pass read the screen (one run).
  it("m1's lane pass is not re-derived when the staging's transaction lands at the seam", async () => {
    const { asks, values } = await run("pair", 12);
    expect(new Set(asks).size, asks.join(" ")).toBe(asks.length);
    expect(asks.slice(-2)).toEqual(["m1:1122", "m1:1123"]);
    expect(values.at(-1)).toBe("1123");
  });
});

describe("#4400: a second write during the hold, distinct encoding", () => {
  it.each(["pair", "split"] as const)("each question asked once (%s)", async reader => {
    const [s, setS] = createSignal(1);
    const asks: string[] = [];
    const out: string[] = [];
    const dispose = createRoot(dispose => {
      const m0 = createMemo(() => {
        const v = 1 + 10 * latest(s) + s();
        asks.push(`m0:${v}`);
        return sleep(v === 23 ? 30 : 10).then(() => v);
      });
      const m1 = createMemo(() => {
        const v = 1 + m0();
        asks.push(`m1:${v}`);
        return sleep(10).then(() => v);
      });
      createLoadingBoundary(
        () => {
          if (reader === "pair")
            createRenderEffect(
              () => `${isPending(m1)},${m1()}`,
              v => void out.push(v)
            );
          else {
            createRenderEffect(
              () => `p${isPending(m1)}`,
              v => void out.push(v)
            );
            createRenderEffect(
              () => `v${m1()}`,
              v => void out.push(v)
            );
          }
          return null;
        },
        () => "L"
      );
      return dispose;
    });
    flush();
    await settle();
    asks.length = 0;
    out.length = 0;
    setS(2);
    flush();
    await sleep(3);
    flush();
    setS(3);
    flush();
    for (let i = 0; i < 4; i++) await settle();
    dispose();
    expect(asks).toEqual(["m0:23", "m0:22", "m0:32", "m1:33", "m0:34", "m1:35"]);
    expect(out.at(-1)).toBe(reader === "pair" ? "false,35" : "pfalse");
  });
});
