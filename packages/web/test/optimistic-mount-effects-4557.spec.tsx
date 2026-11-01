/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import {
  Show,
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createSignal,
  flush
} from "solid-js";
import { render } from "../src/index.js";

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
}

// #4557: a `<Show>` an optimistic guess opens mounts a child whose effects
// read a signal it owns through a memo. `defer` skips their first run, as
// on any mount (#4543), and a later write from inside the child runs each
// effect once (D-8), not once more at the lane's reveal.
for (const defer of [true, false])
  test(`effects a guess mounts honor defer and run once per write (${defer ? "deferred" : "plain"}, #4557)`, async () => {
    const root = document.createElement("div");
    const [enabled, setEnabled] = createSignal(false);
    const [visible, setVisible] = createOptimistic(enabled);
    let release!: () => void;
    const run = action(function* () {
      setEnabled(true);
      setVisible(true);
      yield new Promise<void>(r => (release = r));
    });
    const runs: [string, number, number | undefined][] = [];
    let bump!: (v: number) => void;

    function Child() {
      const [n, setN] = createSignal(1);
      const keys = createMemo(() => n());
      createRenderEffect(
        () => keys(),
        (v, prev) => void runs.push(["render", v, prev]),
        { defer }
      );
      createEffect(
        () => keys(),
        (v, prev) => void runs.push(["user", v, prev]),
        { defer }
      );
      bump = setN;
      return <p>child</p>;
    }

    const dispose = render(
      () => (
        <Show when={visible()}>
          <Child />
        </Show>
      ),
      root
    );
    flush();

    const pending = run();
    flush();
    await settle();
    expect(root.textContent).toBe("child");
    // The frame's own mount of the child (the action's truth opens the
    // `<Show>` too) is replaced by the lane's at the reveal; the last runs
    // are the shown child's.
    const mounted = runs.splice(0).filter(r => r[0] === "user");
    expect(mounted).toEqual(defer ? [] : [["user", 1, undefined]]);

    bump(2);
    flush();
    await settle();
    expect(runs.splice(0)).toEqual([
      ["render", 2, defer ? undefined : 1],
      ["user", 2, defer ? undefined : 1]
    ]);

    release();
    await pending;
    await settle();
    expect(runs.splice(0)).toEqual([]);

    bump(3);
    flush();
    expect(runs.splice(0)).toEqual([
      ["render", 3, 2],
      ["user", 3, 2]
    ]);
    dispose();
  });
