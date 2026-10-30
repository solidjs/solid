/**
 * #4474, the async form (D-22: laziness is never observable; F-9).
 *
 * `m` is an async memo; `a = createMemo(() => fetchEcho(m()))` is an ASYNC memo over it that
 * nobody reads. `m`'s first answer (2) lands in its own flush: a prior reader of `a` would have
 * had `a` start `fetchEcho(2)` there; the unread `a` is released without running (#2934). A write
 * re-asks `m`, and in that flush a `Loading` boundary mounts content reading `latest(a)` and
 * `isPending(a)`.
 *
 * The wake catches `a` up on the committed world: its pass is served `m`'s landed `2` and starts
 * the flight the missed landing would have started (`fetchEcho(2)`), then waits on `m`'s re-ask
 * like any dependent. `a` has produced nothing yet, so `latest(a)` throws (D-22: before a first
 * value) and the boundary — disarmed, it showed `off` — keeps its content (F-5); the screen is
 * the prior reader's at every step: `fetchEcho(2)` lands first (a value for a question `m` has
 * moved past: `l:e2 p:true`), then `m`'s `3`, then `fetchEcho(3)` supersedes `fetchEcho(2)` as
 * it would have (`asyncWrite`'s `_inFlight` check) — no guard against the catch-up flight: the
 * eager memo asks it too, and a guard would be the one observable difference.
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const task = () => new Promise<void>(r => setTimeout(r, 0));

async function run(prior: boolean) {
  const asks: { v: number; resolve: (v: number) => void }[] = [];
  const echoes: { v: number; resolve: (v: string) => void }[] = [];
  const [s, setS] = createSignal(1);
  const m = createMemo(() => {
    const v = 1 + s();
    return new Promise<number>(resolve => asks.push({ v, resolve }));
  });
  const a = createMemo(() => {
    const v = m();
    return new Promise<string>(resolve => echoes.push({ v, resolve }));
  });
  if (prior)
    createRoot(() =>
      createEffect(
        () => a(),
        () => {}
      )
    );
  const leaves: string[] = [];
  const screens: string[] = [];
  createRoot(() => {
    const b = createLoadingBoundary(
      () => {
        const gate = createMemo(() => s() > 1);
        return createMemo(() => {
          if (!gate()) return "off";
          createRenderEffect(
            () => `l:${latest(a)} p:${isPending(a)}`,
            v => void leaves.push(v)
          );
          return "on";
        });
      },
      () => "fallback"
    );
    createRenderEffect(
      () => {
        let v: any = b;
        while (typeof v === "function") v = v();
        return v;
      },
      v => void screens.push(v)
    );
  });
  flush();
  await task();
  flush();
  const first = asks.shift()!;
  first.resolve(first.v);
  await task();
  flush(); // m's answer (2) lands on its own; a prior reader starts fetchEcho(2) here
  const echoesAtLanding = echoes.map(e => e.v);
  setS(2);
  await task();
  flush(); // re-ask m and mount the content
  const reasked = { leaves: [...leaves], screens: [...screens], echoes: echoes.map(e => e.v) };
  // The catch-up flight lands first: a has a value for the question m has moved past.
  const echo2 = echoes.shift()!;
  echo2.resolve(`e${echo2.v}`);
  await task();
  flush();
  const echoed = { leaves: [...leaves], screens: [...screens] };
  const second = asks.shift()!;
  second.resolve(second.v);
  await task();
  flush(); // m = 3: a re-asks fetchEcho(3)
  const echo3 = echoes.shift()!;
  echo3.resolve(`e${echo3.v}`);
  await task();
  flush();
  return { echoesAtLanding, reasked, echoed, landed: { leaves, screens }, left: echoes.length };
}

describe("#4474 (async): an unread async memo woken at the re-ask starts the flight its missed landing would have", () => {
  it("catches up on the committed 2, asks fetchEcho(2), then waits on the re-ask — the prior reader's screens", async () => {
    const lazy = await run(false);
    // Released unread at the landing, a asked nothing then; the wake asks it.
    expect(lazy.echoesAtLanding).toEqual([]);
    expect(lazy.reasked.echoes).toEqual([2]);
    // Nothing produced yet: latest(a) throws (never `undefined`), and the disarmed boundary keeps
    // `off` (F-5) until the hold lands.
    expect(lazy.reasked.leaves).toEqual([]);
    expect(lazy.reasked.screens).toEqual(["off"]);
    // The landing of a question m has moved past: a value, the re-ask pending (D-22, F-9).
    expect(lazy.echoed.leaves).toEqual(["l:e2 p:true"]);
    expect(lazy.echoed.screens).toEqual(["off", "on"]);
    expect(lazy.landed.leaves.at(-1)).toBe("l:e3 p:false");
    expect(lazy.landed.leaves.join()).not.toContain("undefined");
    expect(lazy.left).toBe(0);
    const eager = await run(true);
    expect(eager.echoesAtLanding).toEqual([2]);
    expect({ ...lazy, echoesAtLanding: eager.echoesAtLanding }).toEqual(eager);
  });
});
