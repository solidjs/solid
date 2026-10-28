import { describe, expect, it } from "vitest";
import {
  createErrorBoundary,
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

// async-gen campaign 1 (seed 3289), E3 store twin, minimized case 34:
//   [s0=0 m0=async(s0+s0) m1=memo(latest(m0)+s0 !%4=1)]
//   <Show when=isPending(m0) fb><span split[m1()]></span></Show> :: s0=1
// A derived store's first landing is its first answer: loading before it,
// final at it — never pending (F-9, D-30, A19 exc. 1), exactly as for the
// memo it copies. A sibling derive reading `latest(m0)` gives the landing
// flush a transaction; the leaf born staged from the landing then answered
// `isPending` true for one pass, which opened the gate onto a reader of the
// poisoned `m1`, whose error reached the root boundary.
describe("a derived store's first landing is not pending", () => {
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 6; j++) await Promise.resolve();
      flush();
      await new Promise(r => setTimeout(r, 0));
    }
    flush();
  };

  async function run(via: "memo" | "store", gated: boolean) {
    const log: string[] = [];
    const flights: (() => void)[] = [];
    let set!: (v: number) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [s, setS] = createSignal(0);
      set = setS;
      const m0 = createMemo(() => {
        const v = 1 + 2 * s();
        return new Promise<number>(r => flights.push(() => r(v)));
      });
      const m1 = createMemo(() => {
        const v = 1 + latest(m0) + s();
        if (v % 4 === 1) throw new Error("m1:" + v);
        return v;
      });
      let view0: () => any = m0;
      let view1: () => any = m1;
      if (via === "store") {
        const [st0] = createStore<{ v?: number }>(draft => {
          draft.v = m0();
        }, {});
        const [st1] = createStore<{ v?: number }>(draft => {
          draft.v = m1();
        }, {});
        view0 = () => st0.v;
        view1 = () => st1.v;
      }
      const out = createErrorBoundary(
        () =>
          createLoadingBoundary(
            () => {
              const when = createMemo(() => isPending(view0));
              createRenderEffect(when, v => {
                log.push(`pending:${v}`);
              });
              if (gated)
                createRenderEffect(
                  () => (when() ? view1() : "-"),
                  v => {
                    log.push(`child:${v}`);
                  }
                );
              return "content";
            },
            () => "loading"
          ),
        () => "error"
      );
      createRenderEffect(out, v => {
        log.push(String(v));
      });
    });
    flush();
    set(1);
    await settle();
    while (flights.length) {
      flights.splice(0, 1).forEach(f => f());
      await settle();
    }
    dispose();
    return log;
  }

  it("isPending of the leaf never reads true at the first landing", async () => {
    const memo = await run("memo", false);
    expect(memo).toEqual(["loading", "pending:false", "content"]);
    expect(await run("store", false)).toEqual(memo);
  });

  it("a reader gated on that verdict never opens onto the sibling's error", async () => {
    const memo = await run("memo", true);
    expect(memo).toEqual(["loading", "pending:false", "child:-", "content"]);
    expect(await run("store", true)).toEqual(memo);
  });
});
