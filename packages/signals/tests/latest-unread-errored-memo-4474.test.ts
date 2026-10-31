/**
 * #4474, the errored form (D-22: laziness is never observable; D-41).
 *
 * `m` is an async memo; `d = createMemo(() => m() === 2 ? throw : m())` is a sync memo over it
 * that nobody reads. `m`'s first answer (2) lands in its own flush: a prior reader of `d` would
 * have had `d` throw there; the unread `d` is released without running (#2934). A write re-asks
 * `m` (→ 3), and in that flush a `Loading` boundary mounts content reading `latest(d)` and
 * `isPending(d)`, catching what the read throws.
 *
 * The wake catches `d` up on the committed world: its pass is served `m`'s landed `2` and throws,
 * as the eager memo did at the landing. An errored catch-up has no value to carry through the
 * flight (D-41): it re-derives at the landing (`_blocked`), to `3`. The screen is the prior
 * reader's at every step — the mount that reads the errored, pending `d` is the hold's (no value
 * to show ahead of the landing), and shows `l:3 p:false` when the re-ask lands; before the fix it
 * showed `l:undefined p:true` at the re-ask, a value `d` never produced.
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
  const [s, setS] = createSignal(1);
  let runs = 0;
  const m = createMemo(() => {
    const v = 1 + s();
    return new Promise<number>(resolve => asks.push({ v, resolve }));
  });
  const d = createMemo(() => {
    const v = m();
    runs++;
    if (v === 2) throw new Error(`bad ${v}`);
    return v;
  });
  if (prior)
    createRoot(() =>
      createEffect(
        () => {
          try {
            d();
          } catch {}
        },
        () => {}
      )
    );
  const leaves: string[] = [];
  createRoot(() => {
    const b = createLoadingBoundary(
      () => {
        const gate = createMemo(() => s() > 1);
        return createMemo(() => {
          if (!gate()) return "off";
          createRenderEffect(
            () => {
              const p = isPending(d);
              try {
                return `l:${latest(d)} p:${p}`;
              } catch (e) {
                return `${e instanceof Error ? e.message : "not ready"} p:${p}`;
              }
            },
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
      () => {}
    );
  });
  flush();
  await task();
  flush();
  const first = asks.shift()!;
  first.resolve(first.v);
  await task();
  flush(); // m's answer (2) lands on its own; a prior reader has d throw here
  const runsAtLanding = runs;
  setS(2);
  await task();
  flush(); // re-ask m and mount the content
  const reasked = [...leaves];
  const second = asks.shift()!;
  second.resolve(second.v);
  await task();
  flush(); // m = 3: d re-derives
  return { runsAtLanding, reasked, landed: leaves };
}

describe("#4474 (errored): an unread memo whose catch-up throws is the eager memo's error, then the landing's value", () => {
  it("the catch-up throws on the committed 2 and re-derives at the landing — the prior reader's screens", async () => {
    const lazy = await run(false);
    // Released unread at the landing, d ran nothing then; the wake runs it on the committed 2.
    expect(lazy.runsAtLanding).toBe(0);
    expect(lazy.reasked).toEqual([]);
    expect(lazy.landed).toEqual(["l:3 p:false"]);
    expect(lazy.landed.join()).not.toContain("undefined");
    const eager = await run(true);
    expect(eager.runsAtLanding).toBe(1);
    expect({ ...lazy, runsAtLanding: eager.runsAtLanding }).toEqual(eager);
  });
});
