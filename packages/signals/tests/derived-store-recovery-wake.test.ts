import { describe, expect, it } from "vitest";
import {
  action,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  latest
} from "../src/index.js";

// async-gen campaign 1 (seed 3289), E3 store twin, minimized case 1:
//   [s0=0 m0=memo(s0 !%4=1) m1=async(latest(m0) !%4=3)] <span fx[m1()]></span> :: A(s0=3)
// A derived store over an async memo that reads an errored memo through
// `latest()`. The render effect reading the store met the error in the
// derive's pull, before any leaf existed, so it observes the derive only.
// The recovery re-runs the derive into NotReady (the family's wake), and
// the derive's status is cleared before its landing pass. The landing is
// still the derive's change for that reader (memo parity, F-12/D-39: a new
// answer replaces the error): the reader re-runs and commits the value.
describe("a derived store's landing wakes a reader parked on its error", () => {
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 6; j++) await Promise.resolve();
      flush();
      await new Promise(r => setTimeout(r, 0));
    }
    flush();
  };

  async function run(via: "memo" | "store", how: "action" | "write") {
    const log: string[] = [];
    const flights: (() => void)[] = [];
    let write!: (v: number) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [s, setS] = createSignal(0);
      const m0 = createMemo(() => {
        const v = 1 + s();
        if (v % 4 === 1) throw new Error("m0:" + v);
        return v;
      });
      const m1 = createMemo(() => {
        const v = 1 + latest(m0);
        return new Promise<number>(r => flights.push(() => r(v)));
      });
      let view: () => any = m1;
      if (via === "store") {
        const [state] = createStore<{ v?: number }>(draft => {
          draft.v = m1();
        }, {});
        view = () => state.v;
      }
      const act = action(function* (v: number) {
        setS(v);
        yield new Promise<void>(r => flights.push(r));
      });
      write = how === "action" ? v => act(v) : setS;
      const out = createErrorBoundary(
        () =>
          createLoadingBoundary(
            () => {
              createRenderEffect(view, v => {
                log.push(`v:${v}`);
              });
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
    write(3);
    await settle();
    while (flights.length) {
      flights.splice(0).forEach(f => f());
      await settle();
    }
    dispose();
    return log;
  }

  for (const how of ["action", "write"] as const) {
    it(`${how}: the store's reader commits the recovered value, as the memo's does`, async () => {
      const memo = await run("memo", how);
      // The error stays the display until the new answer lands (D-39: a
      // pending is not a value): the content shows with the reader's value,
      // in one flush, never with the reader still loading.
      expect(memo).toEqual(["error", "v:5", "content"]);
      expect(await run("store", how)).toEqual(memo);
    });
  }
});
