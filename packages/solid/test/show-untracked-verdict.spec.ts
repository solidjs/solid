import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  Loading,
  Show,
  untrack
} from "../src/index.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// A non-keyed Show keeps its child across truthy values. A child that probes
// pending state inside `untrack` (as a router's link claim does when its
// anchor is created) must not make the Show rebuild it whenever `when`'s
// source refetches.
describe("Show with an untracked pending probe in its child", () => {
  it("keeps the child across a refetch of its condition", async () => {
    let builds = 0;
    let setTick!: (v: number) => void;
    let rendered = "";
    createRoot(() => {
      const [tick, set] = createSignal(0);
      setTick = set;
      const summary = createMemo(async () => {
        const n = tick();
        await sleep(5);
        return { n };
      });
      const view = Loading({
        fallback: "loading",
        get children() {
          return Show({
            get when() {
              return summary();
            },
            children: t => {
              builds++;
              untrack(() => isPending(() => {}));
              return () => `n=${t().n}`;
            }
          });
        }
      });
      createRenderEffect(
        () => {
          let v: unknown = view;
          while (typeof v === "function") v = (v as () => unknown)();
          return String(v);
        },
        v => {
          rendered = v;
        }
      );
    });
    flush();
    await sleep(20);
    flush();
    expect(builds).toBe(1);
    expect(rendered).toBe("n=0");

    setTick(1);
    flush();
    await sleep(20);
    flush();
    expect(builds).toBe(1);
    expect(rendered).toBe("n=1");
  });
});
