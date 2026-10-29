/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Two `<Loading>` boundaries share `id`, each over its own async memo of it;
// one is armed by `on={latest(id)}`. `setId(1)` shows the armed boundary's
// fallback (D-17) while the other keeps its content. The armed boundary's
// flight lands first, while the other's still holds the frame: its content
// stays behind the fallback until the frame lands — and then reaches the
// screen. (It stayed on the fallback for good.)
import { expect, test } from "vitest";
import { Loading, createMemo, createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

test("Loading on latest over two flights leaves its fallback once both land", async () => {
  let finishA!: (v: number) => void;
  let finishB!: (v: number) => void;
  const pa = new Promise<number>(r => (finishA = r));
  const pb = new Promise<number>(r => (finishB = r));
  const [id, setId] = createSignal(0);
  const el = document.createElement("div");
  const dispose = render(() => {
    const a = createMemo(() => (id() ? pa : Promise.resolve(1)));
    const b = createMemo(() => (id() ? pb : Promise.resolve(1)));
    return (
      <>
        <Loading on={latest(id)} fallback="[A…]">
          <i>{a()}</i>
        </Loading>
        <Loading fallback="[B…]">
          <b>{b()}</b>
        </Loading>
      </>
    );
  }, el);
  flush();
  await tick();
  expect(el.innerHTML).toBe("<i>1</i><b>1</b>");
  setId(1);
  flush();
  await tick();
  expect(el.innerHTML).toBe("[A…]<b>1</b>");
  finishA(2);
  await tick();
  // The frame still waits on B's flight: A's content lands with it.
  expect(el.innerHTML).toBe("[A…]<b>1</b>");
  finishB(2);
  await tick();
  expect(el.innerHTML).toBe("<i>2</i><b>2</b>");
  dispose();
});
