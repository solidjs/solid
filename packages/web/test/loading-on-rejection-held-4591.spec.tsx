/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4591 (F-2, F-5, F-12, D-41): under an armed `<Loading on={s0()}>`, `a0`'s
 * new question (for `s1 = 2`) rejects while `a1`, read outside the boundary,
 * still holds the `s1 = 2` write. The rejection is an answer for `s1 = 2`: it
 * shows when a value for that question would — at the hold's commit. Until
 * then the boundary keeps its fallback, `s1` stays uncommitted, and `a0`'s
 * answer for `s1 = 0` never shows beside `s1=2`.
 */
import { render } from "../src/index.js";
import { createMemo, createSignal, Errored, flush, Loading, Show } from "solid-js";
import { expect, it } from "vitest";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function run(wrapOutside: boolean) {
  const flights = new Map<string, { resolve: (v: number) => void; reject: (e: Error) => void }>();
  const ask = (key: string) =>
    new Promise<number>((resolve, reject) => flights.set(key, { resolve, reject }));
  const [s0, setS0] = createSignal(0);
  const [s1, setS1] = createSignal(0);
  const el = document.createElement("div");
  const frames: string[] = [];
  const dispose = render(() => {
    const a0 = createMemo(() => ask("a0:" + s1()));
    const a1 = createMemo(() => ask("a1:" + s1()));
    return (
      <Errored fallback={<p>error</p>}>
        {wrapOutside ? (
          <Show when={s1() > 0} fallback={<p>[a1={a1()}]</p>}>
            <p>[a1={a1()}]</p>
          </Show>
        ) : (
          <p>[a1={a1()}]</p>
        )}
        <Loading on={s0()} fallback={<p>loading</p>}>
          <p>[a0={a0()}]</p>
          <p>[s1={s1()}]</p>
        </Loading>
      </Errored>
    );
  }, el);
  await tick();
  flights.get("a1:0")!.resolve(9);
  flights.get("a0:0")!.resolve(10);
  await tick();
  frames.push(el.textContent!);
  setS0(1);
  setS1(1);
  flush();
  await tick();
  frames.push(el.textContent!);
  flights.get("a1:1")!.resolve(11);
  await tick();
  frames.push(el.textContent!);
  setS0(2);
  setS1(2);
  flush();
  await tick();
  frames.push(el.textContent!);
  flights.get("a0:2")!.reject(new Error("boom"));
  await tick();
  frames.push(el.textContent!);
  flights.get("a1:2")!.resolve(12);
  await tick();
  frames.push(el.textContent!);
  dispose();
  return frames;
}

const expected = [
  "[a1=9][a0=10][s1=0]",
  "[a1=9][a0=10][s1=0]",
  "[a1=11]loading",
  "[a1=11]loading",
  "[a1=11]loading",
  "error"
];

it("a rejection under an armed <Loading on> does not reveal a stale value or commit a held write", async () => {
  expect(await run(false)).toEqual(expected);
});

it("the same with the outside reader under <Show when={s1() > 0}>", async () => {
  expect(await run(true)).toEqual(expected);
});
