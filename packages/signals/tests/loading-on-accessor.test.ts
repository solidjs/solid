/**
 * LOADING_ON_ACCESSOR — `<Loading on={route}>` / `on={() => route()}` hands
 * the boundary the accessor itself: a stable value it never calls, so nothing
 * is read and the boundary never re-arms. DEV warns once, on the first run.
 */
import { afterEach, expect, test, vi } from "vitest";
import { createLoadingBoundary, createRoot, createSignal, flush, OBSERVE } from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

function mount(on: () => any) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const capture = OBSERVE!.diagnostics.capture();
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    createLoadingBoundary(
      () => "content",
      () => "fallback",
      { on }
    );
  });
  flush();
  return {
    codes: () => capture.events.map(e => e.code),
    done: () => {
      capture.stop();
      dispose();
    }
  };
}

test("an accessor passed as `on` warns once", () => {
  const [route, setRoute] = createSignal(1);
  // What `<Loading on={route}>` compiles to: a getter returning the accessor.
  const t = mount(() => route);
  expect(t.codes()).toEqual(["LOADING_ON_ACCESSOR"]);
  setRoute(2);
  flush();
  expect(t.codes()).toEqual(["LOADING_ON_ACCESSOR"]);
  t.done();
});

test("the dependency's value does not warn", () => {
  const [route, setRoute] = createSignal(1);
  const t = mount(() => route());
  setRoute(2);
  flush();
  expect(t.codes()).toEqual([]);
  t.done();
});

test("a dependency list does not warn", () => {
  const [a] = createSignal(1);
  const [b] = createSignal("x");
  const t = mount(() => [a(), b()]);
  expect(t.codes()).toEqual([]);
  t.done();
});
