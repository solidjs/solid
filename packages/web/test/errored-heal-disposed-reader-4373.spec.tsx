/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4373: an <Errored> heals when the only reader that threw is disposed. The
// action's write makes `m` throw; `isPending(m)` opens a branch that reads
// `m()` while the action is out. When the action settles, the branch closes
// and its reader is disposed — nothing on screen reads `m()` any more, so
// nothing keeps the boundary errored: the screen is what a fresh render with
// `s = 1` shows, which is empty.
import { expect, test } from "vitest";
import { Errored, Show, action, createMemo, createSignal, flush, isPending } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

test("Errored heals once the isPending-opened reader that threw is disposed", async () => {
  const container = document.createElement("div");
  let release!: () => void;
  const [s, setS] = createSignal(3);
  const act = action(function* (v: number) {
    setS(v);
    yield new Promise<void>(r => (release = r));
  });
  const dispose = render(() => {
    const m = createMemo(() => {
      if (s() === 1) throw new Error("boom");
      return s();
    });
    return (
      <Errored fallback={() => "[ERR]"}>
        <Show when={isPending(m)}>
          <span>{m()}</span>
        </Show>
      </Errored>
    );
  }, container);
  flush();
  expect(container.innerHTML).toBe("");

  act(1);
  flush();
  await tick();
  release();
  await tick();
  await tick();
  expect(container.innerHTML).toBe("");
  dispose();
});

test("a fresh render with the throwing input shows nothing (the reference)", () => {
  const container = document.createElement("div");
  const [s] = createSignal(1);
  const dispose = render(() => {
    const m = createMemo(() => {
      if (s() === 1) throw new Error("boom");
      return s();
    });
    return (
      <Errored fallback={() => "[ERR]"}>
        <Show when={isPending(m)}>
          <span>{m()}</span>
        </Show>
      </Errored>
    );
  }, container);
  flush();
  expect(container.innerHTML).toBe("");
  dispose();
});

test("Errored stays up while another live reader still holds the error", async () => {
  const container = document.createElement("div");
  let release!: () => void;
  const [s, setS] = createSignal(3);
  const act = action(function* (v: number) {
    setS(v);
    yield new Promise<void>(r => (release = r));
  });
  const dispose = render(() => {
    const m = createMemo(() => {
      if (s() === 1) throw new Error("boom");
      return s();
    });
    return (
      <Errored fallback={() => "[ERR]"}>
        <Show when={isPending(m)}>
          <span>{m()}</span>
        </Show>
        <b>{m()}</b>
      </Errored>
    );
  }, container);
  flush();
  expect(container.innerHTML).toBe("<b>3</b>");

  act(1);
  flush();
  await tick();
  release();
  await tick();
  await tick();
  expect(container.innerHTML).toBe("[ERR]");
  dispose();
});
