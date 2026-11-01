/**
 * #4557: effects a lane mounts. A guess mounts a view (`<Show when={opt()}>`)
 * whose effects read a signal the view owns, directly or through a memo.
 * `defer` skips the first run whatever mounted the effect (#4543), and a
 * write runs each effect once: a computation re-runs only when something it
 * read changed (D-8), and a lane sees the screen plus its own guesses
 * (D-37) — it does not replay a run the screen already made.
 *
 * The transaction's own frame mounts the view too (its truth turns the
 * condition true); the lane's mount replaces it at the reveal. The runs
 * below are the shown view's.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flush();
};

function setup(defer: boolean, viaMemo: boolean) {
  const [enabled, setEnabled] = createSignal(false);
  const [visible, setVisible] = createOptimistic(enabled);
  let release!: () => void;
  const run = action(function* () {
    setEnabled(true);
    setVisible(true);
    yield new Promise<void>(r => (release = r));
  });
  const runs: [number, string, number, number | undefined][] = [];
  let views = 0;
  let write!: (v: number) => void;
  const view = () => {
    const id = ++views;
    const [n, setN] = createSignal(1);
    const source = viaMemo ? createMemo(() => n()) : n;
    createRenderEffect(
      () => source(),
      (v, prev) => void runs.push([id, "render", v, prev]),
      { defer }
    );
    createEffect(
      () => source(),
      (v, prev) => void runs.push([id, "user", v, prev]),
      { defer }
    );
    write = setN;
    return "view";
  };
  let shown: unknown;
  createRoot(() => {
    const condition = createMemo(() => !!visible());
    const content = createMemo(() => (condition() ? untrack(view) : undefined));
    createRenderEffect(content, v => void (shown = v));
  });
  flush();
  const take = () => {
    const mine = runs.filter(r => r[0] === views).map(([, ...r]) => r);
    runs.length = 0;
    return mine;
  };
  return {
    run,
    take,
    write: (v: number) => write(v),
    shown: () => shown,
    release: () => release()
  };
}

describe("#4557: effects a lane mounts", () => {
  for (const defer of [true, false])
    for (const viaMemo of [false, true]) {
      const label = `${defer ? "deferred" : "plain"} effects, ${viaMemo ? "through a memo" : "direct read"}`;
      const mount = defer
        ? []
        : [
            ["render", 1, undefined],
            ["user", 1, undefined]
          ];
      const ran = (v: number, prev: number | undefined) => [
        ["render", v, prev],
        ["user", v, prev]
      ];

      it(`${label}: mounted by a guess, then written while the lane is live`, async () => {
        const s = setup(defer, viaMemo);
        const p = s.run();
        flush();
        await settle();
        expect({ shown: s.shown(), runs: s.take() }).toEqual({ shown: "view", runs: mount });

        s.write(2);
        flush();
        await settle();
        expect(s.take()).toEqual(ran(2, defer ? undefined : 1));

        s.release();
        await p;
        await settle();
        expect({ shown: s.shown(), runs: s.take() }).toEqual({ shown: "view", runs: [] });

        s.write(3);
        flush();
        expect(s.take()).toEqual(ran(3, 2));
      });

      it(`${label}: mounted by a guess, written after the action lands`, async () => {
        const s = setup(defer, viaMemo);
        const p = s.run();
        flush();
        await settle();
        s.release();
        await p;
        await settle();
        expect({ shown: s.shown(), runs: s.take() }).toEqual({ shown: "view", runs: mount });

        s.write(2);
        flush();
        expect(s.take()).toEqual(ran(2, defer ? undefined : 1));
      });
    }
});
