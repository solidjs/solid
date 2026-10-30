import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

// D-22 (amended 2026-10-30), F-9, async generator E2 (3289 #310, 91501 #1993,
// #2609): an async memo answered, then re-asked in one flush. When the
// memo's input is read through `latest()` (or through a sync memo), the
// write's re-ask reaches the memo after its landing has run, and the landing
// released the identity memo's wait: it runs with no value and waits on
// nothing. It still derives from the answer — which of the two the flush ran
// first is the flush's order, not the reader's — so `latest` of it shows
// what `latest` of the memo shows.
const task = () => new Promise<void>(r => setTimeout(r, 0));

async function run(shape: "latest" | "superseded" | "via-memo", view: "memo" | "identity") {
  const asks: { v: number; resolve: (v: number) => void }[] = [];
  const [s, setS] = createSignal(shape === "via-memo" ? 2 : 1);
  const flight = (v: number) => new Promise<number>(resolve => asks.push({ v, resolve }));
  let m: () => number;
  if (shape === "via-memo") {
    const m0 = createMemo(() => latest(s) + 1);
    m = createMemo(() => flight(m0() + 1));
  } else m = createMemo(() => flight(latest(s) + 1));
  const x = view === "memo" ? m : createMemo(() => m());
  let leaf = "";
  let output = "";
  createRoot(() => {
    const b = createLoadingBoundary(
      () => {
        createRenderEffect(
          () => `l:${latest(x)}`,
          v => {
            leaf = v;
          }
        );
        return "content";
      },
      () => "fallback"
    );
    createRenderEffect(b, v => {
      output = v;
    });
  });
  const settle = (pick: number) => {
    const a = asks.splice(pick % asks.length, 1)[0];
    a.resolve(a.v);
  };
  flush();
  if (shape === "superseded") {
    // A second question while the first is in flight; its answer lands in
    // the tick a write asks a third.
    setS(2);
    await Promise.resolve();
    settle(1);
    setS(1);
  } else {
    await task();
    flush();
    settle(0);
    setS(0);
  }
  await task();
  flush();
  return output === "content" ? leaf : output;
}

describe("an answered-then-reasked first answer reaches a reader its landing released", () => {
  for (const [shape, shown] of [
    ["latest", "l:2"],
    ["superseded", "l:3"],
    ["via-memo", "l:4"]
  ] as const)
    it(`${shape}: an identity memo shows what the memo shows`, async () => {
      expect(await run(shape, "memo")).toBe(shown);
      expect(await run(shape, "identity")).toBe(shown);
    });
});
