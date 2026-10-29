/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * D-39 / D-41: a sync memo that errored and recovers under an open action
 * keeps its error on screen until the action commits (F-7). Content beside
 * a display-ahead `latest()` reads the screen (D-25, A10): the shown error,
 * not the empty value behind it — before, `<Errored>` swapped to
 * `X1undefined` while the action was still open.
 */
import { expect, test } from "vitest";
import { render } from "../src/index.js";
import { Errored, action, createMemo, createSignal, flush, latest } from "solid-js";

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    flush();
  }
};

test.each(["inline", "memo"])(
  "Errored over `latest(s) + m0()` keeps the error through an open action (%s)",
  async shape => {
    const el = document.createElement("div");
    const [s, setS] = createSignal(0);
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const go = action(function* () {
      setS(1);
      yield gate;
    });
    const dispose = render(() => {
      const m0 = createMemo(() => {
        if (s() === 0) throw new Error("boom");
        return s();
      });
      const text = shape === "memo" ? createMemo(() => "X" + latest(s) + m0()) : null;
      return (
        <Errored fallback={(e: () => any) => `[E ${e()?.message}]`}>
          {text ? text() : "X" + latest(s) + m0()}
        </Errored>
      );
    }, el);
    flush();
    expect(el.innerHTML).toBe("[E boom]");
    go();
    flush();
    expect(el.innerHTML).toBe("[E boom]");
    release();
    await settle();
    expect(el.innerHTML).toBe("X11");
    dispose();
  }
);

// The memo is created by the `<Errored>` content on its first pass and kept
// by closure past the pass that disposes it: the boundary waits on the
// content, not on the dead memo the shown error names, and the first flush
// of the action stays live (#4396 review).
test("Errored over a memo its content created and kept stays live through an open action", async () => {
  const el = document.createElement("div");
  const [s, setS] = createSignal(0);
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  let cached: (() => number) | undefined;
  const dispose = render(
    () => (
      <Errored fallback={(e: () => any) => `[E ${e()?.message}]`}>
        {"X" +
          latest(s) +
          (cached ||= createMemo(() => {
            if (s() === 0) throw new Error("boom");
            return s();
          }))()}
      </Errored>
    ),
    el
  );
  flush();
  expect(el.innerHTML).toBe("[E boom]");
  action(function* () {
    setS(1);
    yield gate;
  })();
  flush();
  expect(el.innerHTML).toBe("[E boom]");
  release();
  await settle();
  expect(el.innerHTML).toBe("X11");
  dispose();
});
