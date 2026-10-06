/**
 * #3835 — a subtree mounted by an optimistic write is the lane's frame
 * (ruling A), all the way down. A memo created by the lane pass used to sit
 * outside the lane while its own body ran, so the render effect it created
 * read the transaction's staged value and was born held: the lane revealed
 * the memo's element with the effect's first run still waiting on the
 * transaction.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  createLoadingBoundary,
  untrack
} from "../src/index.js";

afterEach(() => flush());

const tick = () => new Promise<void>(r => setTimeout(r, 0));

function setup(nested: boolean) {
  type El = { color?: string };
  let shown: El | undefined;
  let run!: () => Promise<void>;
  let finish!: () => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [enabled, setEnabled] = createSignal(false);
    const [visible, setVisible] = createOptimistic(enabled);
    const content = () => {
      const el: El = {};
      createRenderEffect(
        () => (enabled() ? "blue" : "red"),
        v => {
          el.color = v;
        }
      );
      return el;
    };
    const view = createMemo(() => {
      if (!visible()) return undefined;
      return nested ? createMemo(content) : () => content();
    });
    createRenderEffect(
      () => view()?.(),
      el => {
        shown = el;
      }
    );
    const act = action(function* () {
      setEnabled(true);
      setVisible(true);
      yield new Promise<void>(r => (finish = r));
    });
    run = () => act();
  });
  flush();
  return {
    shown: () => (shown ? { ...shown } : undefined),
    run: () => run(),
    finish: () => finish(),
    dispose: () => dispose()
  };
}

describe("#3835 optimistic mount of a nested memo", () => {
  for (const nested of [true, false])
    it(`${nested ? "memo-wrapped" : "direct"} content reveals with the screen value`, async () => {
      const s = setup(nested);
      expect(s.shown()).toBeUndefined();
      const p = s.run();
      flush();
      await tick();
      flush();
      expect(s.shown()).toEqual({ color: "red" });
      s.finish();
      await p;
      await tick();
      flush();
      expect(s.shown()).toEqual({ color: "blue" });
      s.dispose();
    });
});

describe("#3835 a Loading mounted by an optimistic write over a parent flight", () => {
  // A29's boundary exemption holds for lane work too: the boundary's first
  // pass sees the flight pending, held or not, and shows its fallback; it is
  // not handed the flight's committed value.
  for (const order of ["same tick", "after the park"])
    it(`shows its fallback (${order})`, async () => {
      const log: unknown[] = [];
      let run!: () => Promise<void>;
      let finish!: () => void;
      let dispose!: () => void;
      const lands: ((v: number) => void)[] = [];
      createRoot(d => {
        dispose = d;
        const [count, setCount] = createSignal(1);
        const [show, setShow] = createSignal(false);
        const data = createMemo(() => {
          const v = count();
          return v === 1 ? v : new Promise<number>(r => lands.push(r));
        });
        const [visible, setVisible] = createOptimistic(show);
        const view = createMemo(() =>
          visible()
            ? untrack(() =>
                createLoadingBoundary(
                  () => `data ${data()}`,
                  () => "fallback"
                )
              )
            : () => "hidden"
        );
        createRenderEffect(
          () => view()(),
          v => {
            log.push(v);
          }
        );
        const act = action(function* () {
          setCount(2);
          if (order === "after the park") yield tick();
          setShow(true);
          setVisible(true);
          yield new Promise<void>(r => (finish = r));
        });
        run = () => act();
      });
      flush();
      const p = run();
      for (let i = 0; i < 2; i++) {
        flush();
        await tick();
      }
      flush();
      expect(log).toEqual(["hidden", "fallback"]);
      lands.forEach(land => land(2));
      await tick();
      flush();
      expect(log).not.toContain("data 1");
      finish();
      await p;
      await tick();
      flush();
      expect(log.at(-1)).toBe("data 2");
      expect(log).not.toContain("data 1");
      dispose();
    });
});
