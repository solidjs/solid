import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

afterEach(() => flush());

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe("#3698 sync write beside a visible optimistic value", () => {
  it("publishes at once through a condition memo that owns a child memo", async () => {
    let dispose!: () => void;
    let drag!: () => boolean;
    let optimistic!: () => boolean;
    let run!: () => void;
    const log: string[] = [];
    createRoot(d => {
      dispose = d;
      const [o, setOptimistic] = createOptimistic(false);
      const [dr, setDrag] = createSignal(false);
      optimistic = o;
      drag = dr;
      const move = action(function* () {
        setOptimistic(true);
        yield new Promise<void>(() => {});
      });
      run = () => {
        void move();
        setTimeout(() => setDrag(true), 0);
      };
      // Mirrors the child memo the compiler emits for `when={a() && !b()}`.
      const condition = createMemo(() => {
        const visible = createMemo(() => !!o());
        return visible() ? !dr() : o();
      });
      const value = createMemo(() => (condition() ? "child" : undefined), { sync: true });
      createRenderEffect(value, v => {
        log.push(`show:${v}`);
      });
      createRenderEffect(
        () => `drag:${dr()} latest:${latest(dr)} pending:${isPending(dr)}`,
        v => {
          log.push(v);
        }
      );
    });
    flush();
    expect(log).toEqual(["show:undefined", "drag:false latest:false pending:false"]);

    log.length = 0;
    run();
    await tick();
    await tick();
    expect(optimistic()).toBe(true);
    expect(drag()).toBe(true);
    expect(latest(drag)).toBe(true);
    expect(isPending(drag)).toBe(false);
    expect(log.at(-1)).toBe("drag:true latest:true pending:false");
    expect(log.filter(l => l.startsWith("show:"))).toEqual(["show:child", "show:undefined"]);
    dispose();
  });
});
