/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4569 (ruled 2026-10-31, today's behaviour; D-23, F-9, S-40; #3373, #4459, #4495): a first
 * load under `<Loading>` whose chain is re-asked upstream while its own first
 * flight is still up. `a2`'s question changes only when `a2` re-runs (#3373),
 * so `a2:11`, landing while `a2` is pending by propagation from `a0`'s
 * re-ask, initializes `a2`: committed and pending on `a0`. Content that reads
 * only its verdict reveals with `pending` (S-40); content that reads `a2`
 * holds until the chain settles (F-2 — no screen to keep).
 *     loading, loading, loading, pending, pending, settled
 * Rejected reading: `loading ×5, settled` (a first load stays loading until
 * the chain settles) — needs a supersession-by-propagation no rule has and
 * contradicts #4459/#4495's `p:true` first reveals.
 * The signals-only twin carries the full write-up, the 3-deep chain, the
 * no-boundary form and the plain-read controls:
 * `packages/signals/tests/first-load-superseded-answer-4569.test.ts`.
 */
import { render } from "../src/index.js";
import { createMemo, createSignal, flush, isPending, Loading } from "solid-js";
import { expect, it } from "vitest";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function run() {
  const flights = new Map<string, (v: number) => void>();
  const ask = (key: string) => new Promise<number>(resolve => flights.set(key, resolve));
  const [s, setS] = createSignal(0);
  const el = document.createElement("div");
  const frames: string[] = [];
  const dispose = render(() => {
    const a0 = createMemo(() => ask("a0:" + s()));
    const a2 = createMemo(async () => ask("a2:" + (await a0())));
    return (
      <Loading fallback={<p>loading</p>}>
        <b>{isPending(() => a2()) ? "pending" : "settled"}</b>
      </Loading>
    );
  }, el);
  await tick();
  frames.push(el.textContent!);
  flights.get("a0:0")!(11);
  await tick();
  frames.push(el.textContent!); // asks a2:11
  setS(1);
  flush();
  await tick();
  frames.push(el.textContent!); // asks a0:1; a2 (no value, a2:11 up) pending by propagation
  flights.get("a2:11")!(16);
  await tick();
  frames.push(el.textContent!); // a2:11 lands on the uninitialized a2: committed, pending on a0
  flights.get("a0:1")!(20);
  await tick();
  frames.push(el.textContent!); // asks a2:20
  flights.get("a2:20")!(21);
  await tick();
  frames.push(el.textContent!);
  dispose();
  return frames;
}

const L = "loading";

it("a first load answered while pending by propagation is committed and pending; the verdict-only content reveals (#4569)", async () => {
  expect(await run()).toEqual([L, L, L, "pending", "pending", "settled"]);
});
