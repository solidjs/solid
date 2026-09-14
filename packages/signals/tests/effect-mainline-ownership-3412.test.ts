/**
 * #3412: an effect stamped by a parked transaction (it was pending on a held
 * async source) recomputes mainline on an unrelated write and no longer reads
 * the held source. The forced re-run inside its own transaction refreshes the
 * staged view but must not claim ownership of the mainline value; if a
 * finalize-time re-entry (a Loading `on` reset's `_disabled` write) makes the
 * transaction active before the effect phase, the mainline value is otherwise
 * parked with it.
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const delay = <T>(ms: number, value: T) => new Promise<T>(r => setTimeout(r, ms, value));

function setup(opts: { boundary: boolean; on: boolean; unconditional: boolean }) {
  const out: Record<string, unknown> = {};
  let setCount!: (v: number) => void;
  let setShow!: (v: boolean) => void;
  createRoot(() => {
    const [count, _setCount] = createSignal(0);
    const [show, _setShow] = createSignal(true);
    setCount = _setCount;
    setShow = _setShow;
    const copy = createMemo(async () => count(), undefined, { name: "copy" });
    const details = createMemo(() => delay(1500, copy()), undefined, { name: "details" });
    createRenderEffect(
      () => String(show()),
      v => {
        out.show = v;
      },
      { name: "E:show" }
    );
    if (opts.unconditional)
      createRenderEffect(
        () => details(),
        v => {
          out.details = v;
        },
        { name: "E:details" }
      );
    createRenderEffect(
      () => (show() ? details() : "hidden"),
      v => {
        out.panel = v;
      },
      { name: "E:panel" }
    );
    if (opts.boundary) {
      const b = createLoadingBoundary(
        () => copy(),
        () => "Loading...",
        opts.on ? { on: () => count() } : undefined
      );
      createRenderEffect(
        () => b(),
        v => {
          out.copy = v;
        },
        { name: "E:copy" }
      );
    } else {
      createRenderEffect(
        () => copy(),
        v => {
          out.copy = v;
        },
        { name: "E:copy" }
      );
    }
  });
  return { out, setCount, setShow };
}

describe("effect mainline ownership (#3412)", () => {
  for (const opts of [
    { boundary: true, on: true, unconditional: true },
    { boundary: true, on: false, unconditional: true },
    { boundary: false, on: false, unconditional: true },
    { boundary: true, on: true, unconditional: false }
  ]) {
    test(`panel hides when show flips ${JSON.stringify(opts)}`, async () => {
      const { out, setCount, setShow } = setup(opts);
      flush();
      await vi.advanceTimersByTimeAsync(1500);
      flush();
      setCount(1);
      flush();
      await vi.advanceTimersByTimeAsync(500);
      flush();
      setShow(false);
      flush();
      await Promise.resolve();
      flush();
      const afterShow = { ...out };
      await vi.advanceTimersByTimeAsync(1500);
      flush();
      expect(afterShow.panel).toBe("hidden");
    });
  }
});
