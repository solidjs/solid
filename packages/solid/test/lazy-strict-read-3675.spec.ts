/**
 * @vitest-environment jsdom
 *
 * #3675: a lazy() component's body is a component body. It rendered the
 * loaded component through a bare `untrack(() => Comp(props))`, skipping the
 * component wrapper every JSX tag gets — so its direct signal reads never
 * warned (STRICT_READ_UNTRACKED), and its owner carried no component label.
 * File routes are lazy(), so every route component was affected.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createComponent, createRoot, createSignal, flush, lazy, OBSERVE } from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

function Child(props: { count: () => number }) {
  // A direct read in the component body: the value can never update here.
  return String(props.count());
}

function arm() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const events: any[] = [];
  const unsubscribe = OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "STRICT_READ_UNTRACKED") events.push(e);
  });
  return { events, unsubscribe };
}

afterEach(() => {
  flush();
  vi.restoreAllMocks();
});

describe("#3675 lazy() component bodies are strict-read checked", () => {
  test("control: a plain component body read warns, labeled with the component", () => {
    const { events, unsubscribe } = arm();
    const [count] = createSignal(1, { name: "count" });
    createRoot(() => createComponent(Child, { count }));
    unsubscribe();
    expect(events).toHaveLength(1);
    expect(events[0].data?.strictRead).toBe("<Child>");
  });

  test("a lazy() component body read warns the same way", async () => {
    const { events, unsubscribe } = arm();
    const [count] = createSignal(1, { name: "count" });
    const LazyChild = lazy(() => Promise.resolve({ default: Child }));
    let out!: () => unknown;
    createRoot(() => {
      out = createComponent(LazyChild, { count }) as unknown as () => unknown;
    });
    await tick();
    flush();
    expect(out()).toBe("1");
    unsubscribe();
    expect(events).toHaveLength(1);
    expect(events[0].data?.strictRead).toBe("<Child>");
  });
});
