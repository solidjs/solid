/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createSignal, createMemo, Loading, flush } from "solid-js";
import { render } from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const delay = <T = void,>(ms: number, value?: T) => new Promise<T>(r => setTimeout(r, ms, value));

function setup(opts: { boundary: boolean; on: boolean; unconditional: boolean }) {
  const div = document.createElement("div");
  let setCount!: (v: number) => void;
  let setShow!: (v: boolean) => void;
  const dispose = render(() => {
    const [count, _setCount] = createSignal(0);
    const [show, _setShow] = createSignal(true);
    setCount = _setCount;
    setShow = _setShow;
    const copy = createMemo(async () => count());
    const details = createMemo(() => delay(1500, copy()));
    return (
      <>
        <p>Show: {String(show())}</p>
        {opts.unconditional ? <p>Details: {details()}</p> : null}
        <p>Panel: {show() ? details() : "hidden"}</p>
        <p>
          Copy:{" "}
          {opts.boundary ? (
            opts.on ? (
              <Loading on={count()} fallback="Loading...">
                {copy()}
              </Loading>
            ) : (
              <Loading fallback="Loading...">{copy()}</Loading>
            )
          ) : (
            copy()
          )}
        </p>
      </>
    );
  }, div);
  return { div, setCount, setShow, dispose };
}

describe("Loading on reset with an outside conditional reader (#3412)", () => {
  for (const opts of [
    { boundary: true, on: true, unconditional: true },
    { boundary: true, on: false, unconditional: true },
    { boundary: false, on: false, unconditional: true },
    { boundary: true, on: true, unconditional: false }
  ]) {
    test(`panel hides when show flips ${JSON.stringify(opts)}`, async () => {
      const { div, setCount, setShow, dispose } = setup(opts);
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
      const afterShow = div.textContent;
      await vi.advanceTimersByTimeAsync(1500);
      flush();
      expect(afterShow).toContain("Panel: hidden");
      dispose();
    });
  }
});
