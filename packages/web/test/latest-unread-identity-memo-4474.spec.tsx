/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4474 through `Loading` + `insert` (the signals pin is
 * `signals/tests/latest-unread-identity-memo-4474.test.ts`): laziness is
 * never observable (D-22, ruled 2026-10-30).
 *
 * `m` is an async memo over `s`; `id = createMemo(() => m())` is an identity
 * memo created at module level that nothing reads. `m`'s first answer (2)
 * lands in its own flush — the unread `id` is released without running
 * (#2934). A write re-asks `m`, and in that same flush a `Loading` boundary
 * mounts content reading `latest(id)` and `isPending(id)`: `l:2 p:true`, then
 * `l:3 p:false` at the landing — the same screen as with a prior reader of
 * `id`, in either read order with a plain `{id()}` beside it. Before the fix
 * the mount read `l:undefined p:true`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Loading,
  Show,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "solid-js";
import { render } from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = async () => {
  await vi.advanceTimersByTimeAsync(0);
  flush();
};

type Plain = "none" | "before" | "after";

async function run(plain: Plain, prior: boolean) {
  const asks: { v: number; resolve: (v: number) => void }[] = [];
  const [s, setS] = createSignal(1);
  const m = createMemo(() => {
    const v = 1 + s();
    return new Promise<number>(resolve => asks.push({ v, resolve }));
  });
  const id = createMemo(() => m());
  let disposePrior = () => {};
  if (prior)
    disposePrior = createRoot(dispose => {
      createEffect(
        () => id(),
        () => {}
      );
      return dispose;
    });
  const div = document.createElement("div");
  const dispose = render(
    () => (
      <Loading fallback={<u>fallback</u>}>
        <Show when={s() > 1} fallback={<u>off</u>}>
          {plain === "before" && <b>p:{id()}</b>}
          <i>
            l:{latest(id)} p:{String(isPending(id))}
          </i>
          {plain === "after" && <b>p:{id()}</b>}
        </Show>
      </Loading>
    ),
    div
  );
  const screen = () => div.textContent;
  flush();
  await tick();
  const screens = [screen()];
  const first = asks.shift()!;
  first.resolve(first.v);
  await tick();
  await tick(); // m's answer (2) lands on its own
  screens.push(screen());
  setS(2);
  await tick();
  await tick(); // re-ask m and mount the content
  screens.push(screen());
  const second = asks.shift()!;
  second.resolve(second.v);
  await tick();
  await tick();
  screens.push(screen());
  dispose();
  disposePrior();
  return screens;
}

describe("#4474 (web): latest() of an unread identity memo first read in the flush that re-asks its source", () => {
  // primed (off) | m's 2 landed | re-asked + mounted | landed
  test("verdict reads only: l:2 p:true at the mount, l:3 p:false at the landing", async () => {
    const lazy = await run("none", false);
    expect(lazy).toEqual(["off", "off", "l:2 p:true", "l:3 p:false"]);
    expect(lazy).toEqual(await run("none", true));
  });

  // A plain `id()` in the same mount is not display-ahead (D-27): its reader
  // is born held (D-2) and the mount — the boundary is disarmed, it showed
  // `off` — stays on `off` until the landing (F-5), in either read order.
  for (const plain of ["before", "after"] as const)
    test(`a plain id() ${plain} the verdict reads: the mount waits for the landing, as with a prior reader`, async () => {
      const lazy = await run(plain, false);
      expect(lazy).toEqual([
        "off",
        "off",
        "off",
        plain === "before" ? "p:3l:3 p:false" : "l:3 p:falsep:3"
      ]);
      expect(lazy).toEqual(await run(plain, true));
    });
});
