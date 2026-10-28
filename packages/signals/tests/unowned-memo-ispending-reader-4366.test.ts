// #4366: an unowned memo left with no reader goes dormant (its last reader
// was torn down, or it settled with nothing subscribed). The next read wakes
// it with a recompute. When that read is an `isPending(m1)` probe, the wake
// is the memo's own pass (A31), not the probe's: it must read its sources as
// any pass does. Woken inside the probe window, it read them as the probe
// does, the committed value, so `m1` derived from the screen under a
// landing (`undefined + 1`) or from the value before an error recovered.
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

// Show: a condition memo, and a branch created when it turns truthy.
function show(when: () => unknown, content: () => () => string, fallback = "[F]") {
  const cond = createMemo(() => !!when());
  const branch = createMemo(() => (cond() ? content() : null));
  return () => branch()?.() ?? fallback;
}

function mount(view: () => unknown) {
  let out: unknown;
  createRoot(() =>
    createRenderEffect(
      () => {
        const v = view();
        return typeof v === "function" ? v() : v;
      },
      v => {
        out = v;
      }
    )
  );
  return () => out;
}

for (const probe of [true, false]) {
  const text = (m1: () => number) => () =>
    createMemo(() => `${probe ? String(isPending(m1)) + " " : ""}${String(m1())}`);

  it(`an unowned memo over an async source lands its value${probe ? " with an isPending reader" : ""} (#4366)`, async () => {
    let release!: (v: number) => void;
    const m0 = createMemo(() => new Promise<number>(r => (release = r)));
    const m1 = createMemo(() => m0() + 1);
    const out = mount(() =>
      createLoadingBoundary(
        () => show(m0, text(m1)),
        () => "[L]"
      )
    );
    flush();
    expect(out()).toBe("[L]");
    release(2);
    await tick();
    expect(out()).toBe(probe ? "false 3" : "3");
  });

  it(`an unowned memo re-derives after its source recovers from an error${probe ? " with an isPending reader" : ""} (#4366)`, () => {
    const [s0, set0] = createSignal(3);
    const [s1, set1] = createSignal(3);
    const m0 = createMemo(() => {
      const v = s1() + s0() + 1;
      if (v % 4 === 2) throw new Error("m0:" + v);
      return v;
    });
    const m1 = createMemo(() => m0() + 1);
    const out = mount(() =>
      createErrorBoundary(
        () => show(() => latest(m0), text(m1)),
        e => `[E ${(e() as Error)?.message}]`
      )
    );
    flush();
    expect(out()).toBe(probe ? "false 8" : "8");
    set1(2);
    flush();
    expect(out()).toBe("[E m0:6]");
    set0(2);
    flush();
    expect(out()).toBe(probe ? "false 6" : "6");
  });
}
