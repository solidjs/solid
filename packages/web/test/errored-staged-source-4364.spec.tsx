/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4364: an uninitialized async memo whose re-run throws from a dependency
 * reaches the wrapping <Errored>. The dependency's error is staged (D-41)
 * while the read that throws it publishes at once; the boundary took the
 * staged source as settled and `Loading` revealed an empty hole.
 */
import { expect, test } from "vitest";
import { render } from "../src/index.js";
import { createMemo, createSignal, Errored, Loading, flush, latest } from "solid-js";

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    flush();
  }
};

test.each(["m0() + s()", "latest(m0)", "m0()"])(
  "Errored > Loading > an async memo reading %s shows the dependency's error",
  async shape => {
    const el = document.createElement("div");
    const [s, set] = createSignal(0);
    let release!: (v: unknown) => void;
    const gate = new Promise(r => (release = r));
    const dispose = render(() => {
      const m0 = createMemo(() => {
        if (s() === 2) throw new Error("boom");
        return s();
      });
      const m1 = createMemo(() => {
        const v = shape === "latest(m0)" ? latest(m0) : shape === "m0()" ? m0() : m0() + s();
        return gate.then(() => v);
      });
      return (
        <Errored fallback={(e: () => any) => `[E ${e()?.message}]`}>
          <Loading fallback="[L]">
            <span>{m1()}</span>
          </Loading>
        </Errored>
      );
    }, el);
    flush();
    expect(el.innerHTML).toBe("[L]");
    set(2);
    flush();
    expect(el.innerHTML).toBe("[E boom]");
    release(1);
    await settle();
    expect(el.innerHTML).toBe("[E boom]");
    dispose();
  }
);
