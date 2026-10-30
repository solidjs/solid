/**
 * E2 / #4284 (memo wrapping and grouping never change the result) for a
 * leaf in a held frame. `<Show when={y() > 0}>` opened by an action holding
 * `y`: the branch is that hold's frame (CONFIG_HELD_FRAME — a held pass
 * built it), never on screen until the landing. A leaf in it reading the
 * hold's display-ahead value — `latest(y)` inline, or a memo of it (a
 * verdict-lane node) — re-runs on the hold's next step.
 *
 * Before, the inline leaf's `latest(y)` seated it as the hold's verdict
 * reader (`route`), so its run went out with the verdict lane's reveal,
 * while the same read through a memo was served the memo's staging as the
 * hold's own work (`laneRead`'s L7' arm) and its run waited for the
 * landing: `[10, 20]` beside `[10]`. A member of the frame a held pass of
 * the hold built is the hold's own work, born in its world: it reads
 * plainly and a probe does not rescue it (D-25, as #4426 for its reads);
 * its runs are the frame's, which commits with the hold (D-27's joined
 * pass, A29 ruling A). Every form now waits for the landing.
 *
 * The two-hold shape (the #4455 review): A holds `x`, `m = memo(latest(x)
 * * 10)` is A's verdict lane's, B holds `y`, and `k` reads both — A merges
 * into B. The leaf `[latest(y), m()]` inline, through a memo, or split into
 * two leaves shows the same at every step.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
};

describe("a held frame's leaf over the hold's display-ahead value", () => {
  async function single(form: "inline" | "memo inside" | "memo outside") {
    const [y, setY] = createSignal(0);
    let b1!: () => void, b2!: () => void;
    const actB = action(function* () {
      setY(1);
      yield new Promise<void>(r => (b1 = r));
      setY(2);
      yield new Promise<void>(r => (b2 = r));
    });
    const leaf: unknown[] = [];
    let shown: unknown;
    createRoot(() => {
      const outside = createMemo(() => latest(y) * 10);
      const when = createMemo(() => y() > 0);
      const content = createMemo(() => {
        if (!when()) return "off";
        const read =
          form === "inline"
            ? () => latest(y) * 10
            : form === "memo inside"
              ? createMemo(() => latest(y) * 10)
              : outside;
        createRenderEffect(read, v => void leaf.push(v));
        return "on";
      });
      createRenderEffect(content, v => {
        shown = v;
      });
    });
    flush();
    const steps: unknown[] = [];
    actB();
    await tick();
    steps.push([shown, ...leaf]);
    b1();
    await tick();
    await tick();
    steps.push([shown, ...leaf]);
    b2();
    await tick();
    await tick();
    steps.push([shown, ...leaf]);
    return steps;
  }

  const expected = [
    ["off", 10],
    ["off", 10],
    ["on", 10, 20]
  ];
  for (const form of ["inline", "memo inside", "memo outside"] as const)
    it(`one hold, ${form}: the leaf's run waits for the landing`, async () => {
      expect(await single(form)).toEqual(expected);
    });

  async function merged(form: "inline" | "memo" | "split") {
    const [x, setX] = createSignal(0);
    const [y, setY] = createSignal(0);
    let a1!: () => void, a2!: () => void, b1!: () => void;
    const actA = action(function* () {
      setX(1);
      yield new Promise<void>(r => (a1 = r));
      setX(2);
      yield new Promise<void>(r => (a2 = r));
    });
    const actB = action(function* () {
      setY(1);
      yield new Promise<void>(r => (b1 = r));
    });
    let shownM: unknown, shown: unknown, leaf: unknown;
    createRoot(() => {
      const m = createMemo(() => latest(x) * 10);
      const k = createMemo(() => x() + y());
      createRenderEffect(m, v => {
        shownM = v;
      });
      createRenderEffect(k, () => {});
      const when = createMemo(() => y() > 0);
      const content = createMemo(() => {
        if (!when()) return "off";
        if (form === "inline")
          createRenderEffect(
            () => `${latest(y)}/${m()}`,
            v => {
              leaf = v;
            }
          );
        else if (form === "memo") {
          const mm = createMemo(() => `${latest(y)}/${m()}`);
          createRenderEffect(mm, v => {
            leaf = v;
          });
        } else {
          let ly: unknown, lm: unknown;
          createRenderEffect(
            () => latest(y),
            v => {
              ly = v;
              leaf = `${ly}/${lm}`;
            }
          );
          createRenderEffect(m, v => {
            lm = v;
            leaf = `${ly}/${lm}`;
          });
        }
        return "on";
      });
      createRenderEffect(content, v => {
        shown = v;
      });
    });
    flush();
    const steps: unknown[] = [];
    actA();
    await tick();
    actB();
    await tick();
    steps.push([shownM, shown, leaf]);
    a1();
    await tick();
    await tick();
    steps.push([shownM, shown, leaf]);
    a2();
    b1();
    await tick();
    await tick();
    steps.push([shownM, shown, leaf]);
    return steps;
  }

  const expectedMerged = [
    [10, "off", "1/10"],
    [20, "off", "1/10"],
    [20, "on", "1/20"]
  ];
  for (const form of ["inline", "memo", "split"] as const)
    it(`merged holds, ${form}: the same screens`, async () => {
      expect(await merged(form)).toEqual(expectedMerged);
    });
});
