/**
 * #3835: a binding created by a lane's mount reads a held write as the
 * screen. An action holds `enabled = true` and guesses `visible = true`;
 * the guess mounts a view whose binding reads `enabled`. A first pass is
 * its creator's — reads and result (ruling A) — so the binding is the
 * lane's stale reader: it shows the committed `false` with the element and
 * re-derives at the action's landing. Before, the first pass read as the
 * action's own pass: inside a memo the binding was born held while the
 * memo's element showed (an element without its binding), and directly
 * under the lane pass it showed the held `true` beside the committed world.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

type El = { style: string };

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flush();
};

async function mountUnderGuess(wrapInMemo: boolean) {
  const [enabled, setEnabled] = createSignal(false);
  const [visible, setVisible] = createOptimistic(enabled);
  let release!: () => void;
  const run = action(function* () {
    setEnabled(true);
    setVisible(true);
    yield new Promise<void>(r => (release = r));
  });
  let shown: El | undefined;
  const inserted: string[] = [];
  const view = (): El => {
    const el = { style: "unset" };
    createRenderEffect(
      () => (enabled() ? "blue" : "red"),
      v => void (el.style = v)
    );
    return el;
  };
  createRoot(() => {
    const condition = createMemo(() => !!visible());
    const content = createMemo(() =>
      condition() ? untrack(() => (wrapInMemo ? createMemo(view) : view())) : undefined
    );
    createRenderEffect(
      () => {
        const v = content();
        return typeof v === "function" ? (v as () => El)() : v;
      },
      el => {
        shown = el;
        inserted.push(el ? `inserted with style ${el.style}` : "none");
      }
    );
  });
  flush();

  const p = run();
  flush();
  await settle();
  const running = { inserted: [...inserted], style: shown?.style };

  release();
  await p;
  await settle();
  return { running, done: { inserted: [...inserted], style: shown?.style } };
}

describe("#3835: a lane's mount reads a held write as the screen", () => {
  it("a binding inside a memo the lane creates lands with its element", async () => {
    const { running, done } = await mountUnderGuess(true);
    expect(running).toEqual({ inserted: ["none", "inserted with style red"], style: "red" });
    expect(done).toEqual({ inserted: ["none", "inserted with style red"], style: "blue" });
  });

  it("a binding the lane pass creates directly shows the committed value", async () => {
    const { running, done } = await mountUnderGuess(false);
    expect(running).toEqual({ inserted: ["none", "inserted with style red"], style: "red" });
    expect(done).toEqual({ inserted: ["none", "inserted with style red"], style: "blue" });
  });
});
