/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #3991: an <Errored> whose content reads a failing async memo through a
// <Show> renders its fallback once per failure, and a reset() whose retry
// fails again leaves the same fallback in place (D-39: the error fallback
// is the display until a new answer replaces the error).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Errored, Loading, Show, createMemo, flush, isPending } from "solid-js";
import { render } from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(5);
    flush();
  }
};

for (const variant of ["show", "text", "outside"] as const)
  test(`one fallback per failure; a failed retry keeps the fallback (${variant})`, async () => {
    let calls = 0;
    let fallbacks = 0;
    let reset!: () => void;
    let rejectSecond!: (e: unknown) => void;
    const second = new Promise<number>((_, r) => (rejectSecond = r));
    second.catch(() => {});
    function App() {
      const data = createMemo(async (): Promise<number> => {
        calls++;
        if (calls === 1) throw new Error("first failure");
        return second;
      });
      return (
        <>
          {variant === "outside" && (
            <Loading>
              <Errored fallback={null}>
                <Show when={data()}>
                  <span>outside</span>
                </Show>
              </Errored>
            </Loading>
          )}
          <Loading>
            <Errored
              fallback={(_e, r) => {
                fallbacks++;
                reset = r;
                return <button type="button">Retry</button>;
              }}
            >
              <Show when={isPending(() => data())}>
                <p>updating</p>
              </Show>
              {variant === "text" ? (
                <p>{data()}</p>
              ) : (
                <Show when={data() > 0}>
                  <p>content</p>
                </Show>
              )}
            </Errored>
          </Loading>
        </>
      );
    }
    const container = document.createElement("div");
    const dispose = render(() => <App />, container);
    await settle();
    const first = container.querySelector("button");
    expect(first).not.toBeNull();
    expect(fallbacks).toBe(1);
    reset();
    await settle();
    expect(calls).toBe(2);
    rejectSecond(new Error("second failure"));
    await settle();
    // The fallback is instantiated once per show: the second error reaches
    // it through the error accessor, the same button stays (focus with it).
    expect(fallbacks).toBe(1);
    expect(container.querySelector("button")).toBe(first);
    dispose();
  });
