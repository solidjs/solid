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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// Fake timers: the gaps between writes are part of each scenario, and on a
// loaded runner (CI coverage) a real 3 ms gap outlived a 10 ms ask, landing
// it before the second write (#4400 asked `m1:23`).
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());
async function settle() {
  for (let i = 0; i < 4; i++) {
    await wait(15);
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
  await wait(gap);
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
  const notReDerived = async (reader: "value" | "beside") => {
    const { asks, out, values } = await run(reader, 12);
    expect(new Set(asks).size, asks.join(" ")).toBe(asks.length);
    expect(asks.slice(-2)).toEqual(["m1:1122", "m1:1123"]);
    expect(values).toEqual(["1122", "1123"]);
    if (reader === "beside") {
      const shown = out.indexOf("c1101");
      expect(out.indexOf("v1122"), out.join(" ")).toBeLessThan(shown);
      expect(out.slice(shown).filter(v => v[0] === "v")).toEqual(["v1123"]);
    }
  };
  it("m1's lane pass is not re-derived over a staging that lands with it (value)", () =>
    notReDerived("value"));
  // #4408 — F-6 (amended 2026-10-28: the parent waits for the lane's
  // flights) and D-26: the lane's readers show its answer together, so
  // `c1101` never shows before `v1122`. `m1` waits on `m0`'s flight as the
  // hold's work (D-25, verdict.ts `holdWork`): it is not re-derived into the
  // s lane early, the lane shows, and `m1:22`'s landing holds the frame
  // `m0b:1100` lands into. Re-derived early (#4397's verdict reader between
  // its flights), the lane was unshown when `m1:22` landed, nothing held
  // that frame, and `c1101` showed while `m1:1122` was in flight.
  it("m1's lane pass is not re-derived over a staging that lands with it (beside, #4408)", () =>
    notReDerived("beside"));

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
    await wait(3);
    flush();
    setS(3);
    flush();
    for (let i = 0; i < 4; i++) await settle();
    dispose();
    expect(asks).toEqual(["m0:23", "m0:22", "m0:32", "m1:33", "m0:34", "m1:35"]);
    expect(out.at(-1)).toBe(reader === "pair" ? "false,35" : "pfalse");
  });
});

// F-6: a `latest()` reader shows the held change now, beside the held screen,
// whatever the grouping (#4284) — and its re-derived memo's readers show the
// lane's answer together. R5 re-derives the frame pass of a `latest()` reader
// in the verdict lane once the flush parks; the verdict lane it joins does
// not reveal at that seam (lanes.ts `laneSeams`), and a parent whose lane
// reveals with readers to re-derive lands a round later (`revealing`), so
// those readers show the lane's answer before the parent's (F-6: the lane
// reveals at its own landing, ahead of the parent's).
describe("#4393: a latest() reader's lane answer reaches the screen", () => {
  // m0 = an async memo over `latest(s) + s()`; the same flush writes `w`,
  // whose unrelated async `X` takes 60 ms and keeps the flush parked. An
  // `isPending(m0)` effect beside `v${m0()}` must not change what it shows
  // (D-23: the verdict is atomic with the value; F-6: grouping never
  // changes the result). It sat in the verdict lane, which revealed at the
  // write before m0's lane pass joined it; m0's reader then read m0 outside
  // that shown lane and waited for `X`.
  for (const sibling of [false, true])
    it(`v(m0) shows the display-ahead answer mid-flight ${sibling ? "with" : "without"} an isPending(m0) sibling`, async () => {
      const [s, setS] = createSignal(1);
      const [w, setW] = createSignal(1);
      const out: string[] = [];
      const ask = (v: number, ms: number) => sleep(ms).then(() => v);
      const dispose = createRoot(dispose => {
        const m0 = createMemo(() => ask(1 + 10 * latest(s) + s(), 10));
        const X = createMemo(() => ask(w(), 60));
        createRenderEffect(X, () => {});
        untrack(() =>
          createLoadingBoundary(
            () => {
              if (sibling)
                createRenderEffect(
                  () => isPending(m0),
                  () => {}
                );
              createRenderEffect(
                () => `v${m0()}`,
                v => void out.push(v)
              );
              return null;
            },
            () => "L"
          )
        );
        return dispose;
      });
      flush();
      await settle();
      out.length = 0;
      setS(2);
      setW(2);
      flush();
      await wait(25);
      flush();
      expect(out).toEqual(["v22"]);
      await settle();
      await settle();
      dispose();
      expect(out).toEqual(["v22", "v23"]);
    });

  // An async memo over `latest(s)*10 + s()*100`, held only by its own
  // flight. The verdict lane asks m1:120 (F-6: async derived from a
  // display-ahead read is the lane's); its answer shows, then the frame's
  // m1:220 — inline and with `latest(s)` extracted into a memo (Ryan,
  // 2026-10-29: `latest()` tears beside the held screen whatever the
  // grouping, #4284). The lane and its parent landed at one seam, and the
  // parent's landing adopted its frame flight before the lane's reader had
  // re-run: only v220 showed.
  for (const form of ["inline", "memo"] as const)
    it(`async m1 over latest(s) (${form}) shows the display-ahead answer, then the frame's`, async () => {
      const [s, setS] = createSignal(1);
      const out: string[] = [];
      const dispose = createRoot(dispose => {
        const v = form === "memo" ? createMemo(() => latest(s)) : () => latest(s);
        const m1 = createMemo(() => {
          const x = v() * 10 + s() * 100;
          return sleep(10).then(() => x);
        });
        untrack(() =>
          createLoadingBoundary(
            () => {
              createRenderEffect(
                () => `v${m1()}`,
                x => void out.push(x)
              );
              return null;
            },
            () => "L"
          )
        );
        return dispose;
      });
      flush();
      await settle();
      out.length = 0;
      setS(2);
      flush();
      await settle();
      await settle();
      dispose();
      expect(out).toEqual(["v120", "v220"]);
    });

  // A sync memo over `latest(s) + s()` under an unrelated hold, read as
  // `[isPending(m0), m0()]`: the pair shows the lane's `false,22` at once.
  // The verdict lane revealed the frame pass's `true,12` first, before the
  // pass that answers for the lane (D-22: if the flush parks, the pass
  // re-derives once as a verdict reader; D-23).
  it("a sync latest() memo's pair reader under an unrelated hold shows the lane's verdict directly", async () => {
    const [s, setS] = createSignal(1);
    const [w, setW] = createSignal(1);
    const out: string[] = [];
    const dispose = createRoot(dispose => {
      const m0 = createMemo(() => 1 + 10 * latest(s) + s());
      const X = createMemo(() => {
        const v = w();
        return sleep(60).then(() => v);
      });
      createRenderEffect(X, v => void out.push(`x${v}`));
      untrack(() =>
        createLoadingBoundary(
          () => {
            createRenderEffect(
              () => `${isPending(m0)},${m0()}`,
              v => void out.push(v)
            );
            return null;
          },
          () => "L"
        )
      );
      return dispose;
    });
    flush();
    await settle();
    out.length = 0;
    setS(2);
    setW(2);
    flush();
    await wait(25);
    flush();
    expect(out).toEqual(["false,22"]);
    await settle();
    await settle();
    dispose();
    expect(out).toEqual(["false,22", "x2", "false,23"]);
  });
});
