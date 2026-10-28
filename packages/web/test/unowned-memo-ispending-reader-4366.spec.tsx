/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4366: module-level (unowned) memos, a reader that probes `isPending(m1)`
// before reading `m1()`. The probe must not cost `m1` its recompute.
import { expect, test } from "vitest";
import {
  Errored,
  Loading,
  Show,
  createMemo,
  createSignal,
  flush,
  isPending,
  latest
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

test("unowned memo over an async source lands its value with an isPending reader (#4366)", async () => {
  let release!: (v: number) => void;
  const m0 = createMemo(() => new Promise<number>(r => (release = r)));
  const m1 = createMemo(() => m0() + 1);
  const el = document.createElement("div");
  const dispose = render(
    () => (
      <Loading fallback="[L]">
        <Show when={m0()}>
          <span>
            {String(isPending(m1))} {String(m1())}
          </span>
        </Show>
      </Loading>
    ),
    el
  );
  flush();
  expect(el.textContent).toBe("[L]");
  release(2);
  await tick();
  expect(el.textContent).toBe("false 3");
  dispose();
});

test("unowned memo re-derives after its source recovers from an error, with an isPending reader (#4366)", () => {
  const [s0, set0] = createSignal(3);
  const [s1, set1] = createSignal(3);
  const m0 = createMemo(() => {
    const v = s1() + s0() + 1;
    if (v % 4 === 2) throw new Error("m0:" + v);
    return v;
  });
  const m1 = createMemo(() => m0() + 1);
  const el = document.createElement("div");
  const dispose = render(
    () => (
      <Errored fallback={(e: any) => `[E ${e()?.message}]`}>
        <Show when={latest(m0)} fallback="[F]">
          <span>
            {String(isPending(m1))} {String(m1())}
          </span>
        </Show>
      </Errored>
    ),
    el
  );
  flush();
  expect(el.textContent).toBe("false 8");
  set1(2);
  flush();
  expect(el.textContent).toBe("[E m0:6]");
  set0(2);
  flush();
  expect(el.textContent).toBe("false 6");
  dispose();
});
