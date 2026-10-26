/**
 * #4284 — `latest()` tears ahead of the screen, and the frame does not depend
 * on how reads are grouped into render effects.
 *
 * An action writes `x` (a plain signal, or an optimistic guess) and yields a
 * promise. A render effect shows `${x()} ${derived()} / ${latest(x)}`, either
 * as one effect or split into `${x()} ${derived()} /` and `${latest(x)}`.
 *
 * - held write: `1 / 5` either way;
 * - guess, no downstream async: `5 / 5` either way;
 * - guess with a downstream async memo (`derived`, the lane held on it):
 *   `1 x1 / 5` either way — the render effect reads the guess as the screen
 *   (committed) beside `latest(guess)` — and `5 x5 / 5` at the lane's
 *   landing. The guess does not reveal before `derived(5)` lands.
 *
 * Before, the combined effect entered the lane on its `x()` read and parked
 * with it, freezing the `latest(x)` beside it at `1 x1 / 1`.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

type Kind = "held" | "opt" | "lane";
type Mode = "one" | "split";
type Order = "plain-first" | "latest-first";

async function tick() {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
}

function setup(kind: Kind, mode: Mode, order: Order = "plain-first") {
  let resolveDerived: (() => void) | undefined;
  let resolveAction!: () => void;
  let attempt!: () => Promise<void>;
  let screen = "";
  let a = "";
  let b = "";
  const dispose = createRoot(d => {
    let x: () => number;
    let set: (v: number) => void;
    if (kind === "held") [x, set] = createSignal(1);
    else {
      const [base] = createSignal(1);
      [x, set] = createOptimistic(() => base());
    }
    const derived =
      kind === "lane"
        ? createMemo(() =>
            x() === 1 ? "x1" : new Promise<string>(r => (resolveDerived = () => r("x" + x())))
          )
        : () => "-";
    attempt = action(function* () {
      set(5);
      yield new Promise<void>(r => (resolveAction = r));
    });
    if (mode === "one")
      createRenderEffect(
        () => {
          if (order === "latest-first") {
            const l = latest(x);
            return `${x()} ${derived()} / ${l}`;
          }
          return `${x()} ${derived()} / ${latest(x)}`;
        },
        v => void (screen = v)
      );
    else {
      createRenderEffect(
        () => `${x()} ${derived()} /`,
        v => void (screen = `${(a = v)} ${b}`)
      );
      createRenderEffect(
        () => latest(x),
        v => void (screen = `${a} ${(b = String(v))}`)
      );
    }
    return d;
  });
  return {
    dispose,
    attempt,
    screen: () => screen,
    resolveDerived: () => resolveDerived!(),
    resolveAction: () => resolveAction()
  };
}

describe("#4284 latest() tears ahead of the hold however reads are grouped", () => {
  for (const mode of ["one", "split"] as const) {
    it(`held write (${mode}): the screen beside latest — 1 - / 5`, async () => {
      const t = setup("held", mode);
      flush();
      await tick();
      expect(t.screen()).toBe("1 - / 1");
      void t.attempt();
      flush();
      await tick();
      expect(t.screen()).toBe("1 - / 5");
      t.resolveAction();
      await tick();
      expect(t.screen()).toBe("5 - / 5");
      t.dispose();
    });

    it(`guess, no downstream async (${mode}): the lane shows — 5 - / 5`, async () => {
      const t = setup("opt", mode);
      flush();
      await tick();
      void t.attempt();
      flush();
      await tick();
      expect(t.screen()).toBe("5 - / 5");
      t.dispose();
    });

    it(`guess with a downstream async memo (${mode}): 1 x1 / 5, then 5 x5 / 5 at the landing`, async () => {
      const t = setup("lane", mode);
      flush();
      await tick();
      expect(t.screen()).toBe("1 x1 / 1");
      void t.attempt();
      flush();
      await tick();
      // The lane holds on derived(5): the guess does not reveal; latest tears.
      expect(t.screen()).toBe("1 x1 / 5");
      t.resolveDerived();
      await tick();
      expect(t.screen()).toBe("5 x5 / 5");
      t.dispose();
    });
  }

  it("guess with a downstream async memo, latest() read first in the one effect: 1 x1 / 5, then 5 x5 / 5", async () => {
    const t = setup("lane", "one", "latest-first");
    flush();
    await tick();
    void t.attempt();
    flush();
    await tick();
    expect(t.screen()).toBe("1 x1 / 5");
    t.resolveDerived();
    await tick();
    expect(t.screen()).toBe("5 x5 / 5");
    t.dispose();
  });

  it("guess, no downstream async, one effect: one pass for the guess (no stale re-run)", async () => {
    let passes = 0;
    let attempt!: () => Promise<void>;
    const seen: string[] = [];
    const dispose = createRoot(d => {
      const [base] = createSignal(1);
      const [x, set] = createOptimistic(() => base());
      attempt = action(function* () {
        set(5);
        yield new Promise<void>(() => {});
      });
      createRenderEffect(
        () => (passes++, `${x()} / ${latest(x)}`),
        v => void seen.push(v)
      );
      return d;
    });
    flush();
    void attempt();
    flush();
    await tick();
    expect(seen).toEqual(["1 / 1", "5 / 5"]);
    expect(passes).toBe(2);
    dispose();
  });
});
