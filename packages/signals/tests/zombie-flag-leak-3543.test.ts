/**
 * #3543: a deferred (zombie) child that recomputes while an unrelated action
 * is parked loses REACTIVE_ZOMBIE — recompute()/updateIfNecessary() rewrite
 * `_flags` wholesale. At the owner's commit `disposeChildren(child, true)`
 * then takes the ordinary parent-chain splice and, with no `_prevSibling`,
 * writes `parent._firstChild = next`, detaching the REPLACEMENT child. The
 * replacement stays subscribed but no owner cleanup can reach it again.
 *
 * Shape is the compiler's `<Show when={n() > 0 && n() < 2}>`: a condition
 * memo whose getter creates a nested memo on every run.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

function setup() {
  const [n, setN] = createSignal(0);
  const [a, setA] = createSignal(0);
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const run = action(async function* () {
    setA(v => v + 1);
    yield gate;
  });
  let disposeRoot!: () => void;
  // runs of the nested memo: every live copy subscribed to `n` runs per write
  let runs = 0;
  createRoot(d => {
    disposeRoot = d;
    const cond = createMemo(() => {
      const c = createMemo(() => (runs++, n() > 0));
      return c() && n() < 2;
    });
    createRenderEffect(
      () => a(),
      () => {}
    );
    createRenderEffect(
      () => cond(),
      () => {}
    );
  });
  flush();
  const toggle = (times: number) => {
    for (let i = 0; i < times; i++) {
      setN(i % 2 ? 0 : 1);
      flush();
    }
  };
  // nested-memo runs caused by one more write
  const runsPerWrite = () => {
    const before = runs;
    setN(v => (v ? 0 : 1));
    flush();
    return runs - before;
  };
  return { toggle, runsPerWrite, run, release, disposeRoot };
}

describe("#3543 zombie child recompute keeps its zombie flag", () => {
  it("control: no pending action keeps subscribers bounded", () => {
    const { toggle, runsPerWrite } = setup();
    toggle(40);
    expect(runsPerWrite()).toBeLessThanOrEqual(2);
  });

  it("pending unrelated action keeps subscribers bounded, and after it finishes", async () => {
    const { toggle, runsPerWrite, run, release, disposeRoot } = setup();
    const done = run();
    flush();
    toggle(40);
    expect(runsPerWrite()).toBeLessThanOrEqual(2);
    release();
    await done;
    flush();
    expect(runsPerWrite()).toBeLessThanOrEqual(2);
    disposeRoot();
    expect(runsPerWrite()).toBe(0);
  });
});
