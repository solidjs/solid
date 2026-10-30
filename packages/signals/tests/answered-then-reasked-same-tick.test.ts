import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest
} from "../src/index.js";

// D-22 (amended 2026-10-30), F-9: an async memo's first answer resolves, and
// in the same synchronous turn a plain write re-asks it; the promise reaction
// runs after the write, so the landing and the re-ask are processed in one
// flush. The answer exists from when it resolved: the memo is answered, then
// re-asked — `latest` shows the answer, the re-ask is a new question
// (`isPending` true), and a derivation of the memo reads the same (async
// generator E2/E3, `t S5 s0=2 t` and `t S6 s0=0 t`) — at every depth: an
// identity memo of an identity memo reads as the memo does (D-22).
const task = () => new Promise<void>(r => setTimeout(r, 0));

async function sameTick(
  view: "memo" | "identity" | "identity2" | "store",
  probe: "pending" | "latest"
) {
  const asks: { v: number; resolve: (v: number) => void }[] = [];
  const [s, setS] = createSignal(1);
  const m = createMemo(() => {
    const v = 1 + s();
    return new Promise<number>(resolve => asks.push({ v, resolve }));
  });
  let x: () => number = m;
  if (view === "identity") x = createMemo(() => m());
  else if (view === "identity2") {
    const i = createMemo(() => m());
    x = createMemo(() => i());
  } else if (view === "store") {
    const [st] = createStore<{ v?: number }>(d => {
      d.v = m();
    }, {});
    x = () => st.v!;
  }
  let leaf = "";
  let output = "";
  createRoot(() => {
    const b = createLoadingBoundary(
      () => {
        createRenderEffect(
          () => (probe === "pending" ? `p:${isPending(x)}` : `l:${latest(x)}`),
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
  const shown = () => (output === "content" ? leaf : output);
  flush();
  await task();
  flush();
  expect(shown()).toBe("fallback");
  // `m:2` resolves; before its reaction runs, `s = 2` asks `m:3`.
  const first = asks.shift()!;
  first.resolve(first.v);
  setS(2);
  await task();
  flush();
  expect(asks.map(a => a.v)).toEqual([3]);
  return shown();
}

describe("a first answer landing in the tick a plain write re-asks it", () => {
  for (const view of ["memo", "identity", "identity2", "store"] as const) {
    it(`${view}: isPending is true — the re-ask is a new question (F-9)`, async () => {
      expect(await sameTick(view, "pending")).toBe("p:true");
    });
    it(`${view}: latest shows the answer (D-22)`, async () => {
      expect(await sameTick(view, "latest")).toBe("l:2");
    });
  }
});

// The derivation's pass that reads the answer is served it once: a second read
// in the same pass is served too, and its re-run waits on the re-ask — also
// when the pass first stopped on another source still loading.
it("a derivation reading the answer twice, or beside a source still loading, settles", async () => {
  const asks: { v: number; resolve: (v: number) => void }[] = [];
  const [s, setS] = createSignal(1);
  const m = createMemo(() => {
    const v = 1 + s();
    return new Promise<number>(resolve => asks.push({ v, resolve }));
  });
  let resolveOther!: (v: number) => void;
  const other = createMemo(() => new Promise<number>(r => (resolveOther = r)));
  const twice = createMemo(() => m() + m());
  const beside = createMemo(() => m() + other());
  const seen: string[] = [];
  const shown = (probe: () => string, name: string) => {
    const b = createLoadingBoundary(
      () => {
        createRenderEffect(probe, v => void seen.push(`${name} ${v}`));
        return "content";
      },
      () => "fallback"
    );
    createRenderEffect(b, () => {});
  };
  createRoot(() => {
    shown(() => `${latest(twice)} ${isPending(twice)}`, "twice");
    shown(() => `${latest(beside)} ${isPending(beside)}`, "beside");
  });
  flush();
  await task();
  flush();
  const first = asks.shift()!;
  first.resolve(first.v);
  setS(2);
  await task();
  flush();
  expect(asks.map(a => a.v)).toEqual([3]);
  expect(seen).toEqual(["twice 4 true"]);
  resolveOther(10);
  await task();
  flush();
  // `beside` never derived a value: its pass over the answer stopped on
  // `other`, and its re-run waits on the re-ask.
  expect(seen).toEqual(["twice 4 true"]);
  const next = asks.shift()!;
  next.resolve(next.v);
  await task();
  flush();
  expect(seen).toEqual(["twice 4 true", "twice 6 false", "beside 13 false"]);
});
