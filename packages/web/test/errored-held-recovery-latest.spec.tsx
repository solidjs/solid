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
