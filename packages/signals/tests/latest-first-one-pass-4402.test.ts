// Pins for what #4393 (R5, D-22) fixed beyond #4365, and #4399.
//
// - #4402: a pass that reads `latest(s)` before `s()` computes once per
//   plain write, as `[s(), latest(s)]` does (D-22: one pass; it re-derives
//   only if the flush parks).
// - #4398: `[isPending(m1), m1()]` in one effect, split across two, or
//   `m1()` alone show the same values when the write changes during the hold
//   (D-26, F-6: a grouped read holds as a lone read; #4284).
// - #4399: two actions, each holding a verdict memo's write, ask `m1:15`
//   once: in A's verdict lane. `m1`'s pass over `m0b`'s landing is the
//   hold's work (D-25: re-run by the write its hold holds, it reads plainly
//   in either read order) and stays out of A's lane; moved into it, it read
//   the landing as the screen and asked `m1:15` again (F-9).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  action,
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

// Fake timers: the flights' order is the script's, not the runner's speed.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
async function settle(n = 4) {
  for (let i = 0; i < n; i++) {
    await wait(15);
    flush();
  }
}

describe("#4402: latest(s) before s() computes once on a plain write", () => {
  for (const order of ["latest first", "plain first"] as const)
    for (const reader of ["render effect", "memo", "user effect"] as const)
      it(`${order}, ${reader}`, () => {
        const [s, set] = createSignal(0);
        let runs = 0;
        const f = () => (runs++, order === "latest first" ? [latest(s), s()] : [s(), latest(s)]);
        const dispose = createRoot(dispose => {
          if (reader === "render effect") createRenderEffect(f, () => {});
          else if (reader === "user effect") createEffect(f, () => {});
          else createRenderEffect(createMemo(f), () => {});
          return dispose;
        });
        flush();
        runs = 0;
        set(1);
        flush();
        expect(runs).toBe(1);
        dispose();
      });
});

type Reader = "pair" | "split" | "value";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

async function run(reader: Reader, script: "change" | "two-actions") {
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
    const m0 = createMemo(() => ask("m0", 1 + latest(s) + s()));
    const m0b = createMemo(() => ask("m0b", 10 * (latest(t) + t())));
    const m1 = createMemo(() => ask("m1", 1 + m0() + (script === "two-actions" ? m0b() : 0)));
    const h = createMemo(() => (s() === 1 ? 1 : sleep(80).then(() => 1)));
    createLoadingBoundary(
      () => {
        const pre = () => (script === "two-actions" ? h() : 0);
        if (reader === "pair") createRenderEffect(() => (pre(), `${isPending(m1)},v${m1()}`), show);
        else if (reader === "split") {
          createRenderEffect(() => (pre(), `p${isPending(m1)}`), show);
          createRenderEffect(() => (pre(), `v${m1()}`), show);
        } else createRenderEffect(() => (pre(), `v${m1()}`), show);
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
  if (script === "change") {
    setS(2);
    await wait(25);
    flush();
    setS(4);
  } else {
    action(function* () {
      setS(2);
      yield sleep(30);
    })();
    await wait(5);
    action(function* () {
      setT(1);
      yield sleep(50);
    })();
    flush();
  }
  await settle();
  await settle();
  await settle();
  dispose();
  const values = out.map(v => v.match(/v(\d+)/)?.[1]).filter(v => v !== undefined);
  return { asks, values: values.filter((v, i) => v !== values[i - 1]) };
}

describe("#4398: grouping isPending(m1) with m1() shows the same values", () => {
  it.each(["pair", "split", "value"] as const)("a change during the hold (%s)", async reader => {
    // The screen before the write (`4`) shows again only in the pair, where
    // `isPending` turns true beside it.
    const { values } = await run(reader, "change");
    expect(values.filter(v => v !== "4")).toEqual(["5", "8", "10"]);
  });
});

describe("#4399: two actions, each holding a verdict memo's write", () => {
  // F-9: a re-ask of the same question is no new question. D-25: `m1`'s
  // pass over `m0b`'s landing is its hold's work, not A's verdict lane's
  // (lanes.ts `holdsPass`).
  const once = async (reader: Reader) => {
    const { asks, values } = await run(reader, "two-actions");
    expect(new Set(asks).size, asks.join(" ")).toBe(asks.length);
    expect(values.at(-1)).toBe("26");
  };
  it.each(["pair", "split", "value"] as const)("each question asked once (%s)", once);
});
