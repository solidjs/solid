/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createSignal, createMemo, Loading, Show, latest, flush } from "solid-js";
import { render } from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type Variant =
  | "show-static-latest"
  | "show-callback-latest"
  | "show-static-committed"
  | "show-callback-committed"
  | "on-committed"
  | "on-latest";

/** The issue's repro (#3540): one signal, one 1s async memo `data`, A under
 * test, B a plain `<Loading>` reading `data()` beside it. `mounts` counts
 * how many times A's `<Loading>` was created. */
function setup(variant: Variant) {
  const div = document.createElement("div");
  let setCount!: (v: number) => void;
  let mounts = 0;
  const dispose = render(() => {
    const [count, _set] = createSignal(1);
    setCount = _set;
    const data = createMemo(async () => {
      const v = count();
      await delay(1000);
      return v;
    });
    const L = () => {
      mounts++;
      return <Loading fallback="Loading A">{data()}</Loading>;
    };
    const A = () => {
      switch (variant) {
        case "show-static-latest":
          return (
            <Show keyed when={latest(count)}>
              <L />
            </Show>
          );
        case "show-callback-latest":
          return (
            <Show keyed when={latest(count)}>
              {(_c: number) => <L />}
            </Show>
          );
        case "show-static-committed":
          return (
            <Show keyed when={count()}>
              <L />
            </Show>
          );
        case "show-callback-committed":
          return (
            <Show keyed when={count()}>
              {(_c: number) => <L />}
            </Show>
          );
        case "on-committed":
          return (
            <Loading on={count()} fallback="Loading A">
              {data()}
            </Loading>
          );
        case "on-latest":
          return (
            <Loading on={latest(count)} fallback="Loading A">
              {data()}
            </Loading>
          );
      }
    };
    return (
      <>
        <p>Count: {count()}</p>
        <p>
          A: <A />
        </p>
        <p>
          B: <Loading fallback="Loading B">{data()}</Loading>
        </p>
      </>
    );
  }, div);
  return { div, setCount, dispose, mounts: () => mounts };
}

const HELD = "Count: 1A: 1B: 1";
const EARLY = "Count: 1A: Loading AB: 1";
const LANDED = "Count: 2A: 2B: 2";

describe("Loading `on` ≡ keyed Show around the boundary; a boundary is never born held (#3540)", () => {
  // Over `latest(count)` the key changes ahead of the write: a keyed `Show`
  // remounts A, and the fresh boundary shows its fallback now (born held
  // exempts boundaries, A29) — the same for `on={latest(count)}`, which
  // resets the boundary without remounting it. Over `count()` the key lands
  // with the write, so every form holds. B — an initialized boundary without
  // a key — forwards data's pending and holds the frame either way (A33).
  //
  // `mounts` pins it — how many times A's `<Loading>` was created [after the
  // first landing, mid-flight, after the second landing]. Static and callback
  // children are re-evaluated by `Show` at the key change: one more mount,
  // mid-flight.
  // (A zero-arg function child is an accessor — evaluated once, not remounted
  // per key — and is deliberately not pinned here.)
  const matrix: Array<[Variant, string, [number, number, number]]> = [
    ["show-static-latest", EARLY, [1, 2, 2]],
    ["show-callback-latest", EARLY, [1, 2, 2]],
    ["show-static-committed", HELD, [1, 2, 2]],
    ["show-callback-committed", HELD, [1, 2, 2]],
    ["on-committed", HELD, [0, 0, 0]],
    ["on-latest", EARLY, [0, 0, 0]]
  ];
  for (const [variant, midFlight, expectedMounts] of matrix) {
    const remounted = expectedMounts[1] > expectedMounts[0];
    test(`${variant}: mid-flight ${midFlight === EARLY ? "reveals fallback early" : "held"}, A ${
      remounted ? "remounted" : "not remounted"
    } at the key change`, async () => {
      const { div, setCount, dispose, mounts } = setup(variant);
      flush();
      await vi.advanceTimersByTimeAsync(1000);
      flush();
      expect(div.textContent).toBe("Count: 1A: 1B: 1");
      const seen: number[] = [mounts()];
      setCount(2);
      flush();
      await Promise.resolve();
      flush();
      expect(div.textContent).toBe(midFlight);
      seen.push(mounts());
      await vi.advanceTimersByTimeAsync(1000);
      flush();
      expect(div.textContent).toBe(LANDED);
      seen.push(mounts());
      expect(seen).toEqual(expectedMounts);
      dispose();
    });
  }
});
