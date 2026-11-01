/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4569 (F-9, D-22, D-23): a first load under `<Loading>` whose chain is
 * re-asked upstream while its own first flight is still up. Pinned at BOTH
 * candidate screens; the maintainer rules. The signals-only twin with the
 * full write-up, the 3-deep chain and the no-boundary form:
 * `packages/signals/tests/first-load-superseded-answer-4569.test.ts`.
 *
 * R2 — today / #3373, #4459 (one question per node): `a2`'s question is still
 *   "given a0 = 11" until `a0` delivers, so `a2:11` is the current answer; it
 *   initializes `a2`, which stays pending on `a0`'s flight; the boundary
 *   reveals with `pending`.      loading ×3, pending, pending, settled
 * R1 — reporter: an answer landing after an upstream re-ask marked the node
 *   pending answers a superseded world; on a first load it does not
 *   initialize the node; the boundary holds until the chain settles and its
 *   first frame has no pending verdict (F-9: "a first load is loading, not
 *   pending", `isPending` "cannot be true on creation").
 *                                loading ×5, settled
 *   Scoped in time or it contradicts #4459's `p:true` first reveals: there
 *   the answer resolved BEFORE the write (answered, then re-asked); here it
 *   resolves after the re-ask's flush.
 * Crux: does an upstream re-ask that marks a node pending by propagation
 * change the node's question before the node itself re-runs (R1: the later
 * answer is to no current question), or only the node's own re-run (R2,
 * #3373: "nothing superseded it")?
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
  frames.push(el.textContent!); // an answer to the old question lands on uninitialized a2
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

it("today / R2: the old answer initializes a2; the boundary reveals with `pending` (#4569)", async () => {
  expect(await run()).toEqual([L, L, L, "pending", "pending", "settled"]);
});

it.fails("R1: a first load does not reveal with isPending() === true (#4569)", async () => {
  expect(await run()).toEqual([L, L, L, L, L, "settled"]);
});
