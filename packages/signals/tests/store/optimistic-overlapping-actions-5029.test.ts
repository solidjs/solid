import { expect, test } from "vitest";
import {
  action,
  createEffect,
  createOptimisticStore,
  createRoot,
  createStore,
  flush
} from "../../src/index.js";

test("#5029: older optimistic action can settle after a newer action writes another source key", async () => {
  const ends: Record<string, () => void> = {};
  const wait = (key: string) => new Promise<void>(resolve => (ends[key] = resolve));
  const [source, setSource] = createStore({ a: 0, b: 0 });
  const [view, setView] = createOptimisticStore(() => ({ a: source.a, b: source.b }), {
    a: 0,
    b: 0
  });
  const seen: string[] = [];
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    createEffect(
      () => `${view.a} ${view.b}`,
      value => void seen.push(value)
    );
  });
  flush();

  const save = action(function* (key: "a" | "b") {
    setView(draft => {
      draft[key] = 1;
    });
    yield wait(key);
    setSource(draft => {
      draft[key] = 1;
    });
  });

  const first = save("a");
  flush();
  const second = save("b");
  flush();
  ends.b();
  await second;
  flush();
  expect([view.a, view.b]).toEqual([1, 1]);
  ends.a();
  await first;
  flush();

  expect([view.a, view.b]).toEqual([1, 1]);
  expect(seen.at(-1)).toBe("1 1");
  dispose();
});
