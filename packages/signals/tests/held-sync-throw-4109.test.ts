/**
 * #4109 (GabbeV): D-41 for a synchronous memo. A write makes `condition`
 * throw while an async sibling holds the frame. The screen keeps the
 * committed `true`, so an ordinary outside read (an event handler) must
 * serve it too; the error shows, and throws, when the frame reveals.
 */
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => (resolve = res));
  return { promise, resolve };
}
const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};
const read = (fn: () => unknown) => {
  try {
    return fn();
  } catch (e) {
    return (e as Error).cause ?? e;
  }
};

it("#4109: a held synchronous throw keeps the committed value for outside reads", async () => {
  const boom = new Error("Condition failed");
  let sibling = deferred<string>();
  const [count, setCount] = createSignal(0);
  const screen = { cond: undefined as unknown, slow: undefined as unknown };
  let condition!: () => boolean;
  const dispose = createRoot(d => {
    condition = createMemo(() => {
      if (count() > 0) throw boom;
      return true;
    });
    const slow = createMemo(() => {
      count();
      return sibling.promise;
    });
    const errored = createErrorBoundary(condition, () => "error");
    createRenderEffect(errored, v => void (screen.cond = v), { schedule: true });
    createRenderEffect(slow, v => void (screen.slow = v), { schedule: true });
    return d;
  });
  try {
    flush();
    sibling.resolve("initial");
    await tick();
    expect(screen).toEqual({ cond: true, slow: "initial" });
    expect(condition()).toBe(true);

    sibling = deferred<string>();
    setCount(1);
    flush();
    // Held: the frame still shows the button, and the click handler's read
    // serves what the frame shows (D-41, D-29).
    expect(screen).toEqual({ cond: true, slow: "initial" });
    expect(read(condition)).toBe(true);

    await tick();
    expect(screen).toEqual({ cond: true, slow: "initial" });
    expect(read(condition)).toBe(true);

    // One frame: the sibling and the error show together.
    sibling.resolve("updated");
    await tick();
    expect(screen).toEqual({ cond: "error", slow: "updated" });
    expect(read(condition)).toBe(boom);
  } finally {
    dispose();
    flush();
  }
});
