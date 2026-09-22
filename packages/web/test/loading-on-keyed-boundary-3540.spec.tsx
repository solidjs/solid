/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import {
  action,
  createSignal,
  createMemo,
  Errored,
  Loading,
  Show,
  latest,
  flush,
  OBSERVE
} from "solid-js";
import { render } from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Capture DEV diagnostics and silence the console.warn each one also emits. */
function captureDiagnostics() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const capture = OBSERVE!.diagnostics.capture();
  return () => capture.stop().map(e => e.code);
}

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

describe("Loading `on` beside a keyed Show around the boundary; a boundary is never born held (#3540)", () => {
  // A keyed `Show` remounts on its condition's VALUE: over `latest(count)`
  // the key changes ahead of the write and the fresh boundary shows its
  // fallback now (born held exempts boundaries, A29); over `count()` the key
  // lands with the write, so the frame holds. `on` is a dependency list, not
  // a key: count's write notifies it either way, and the boundary stops
  // waiting on its current content — but the fallback swap FOLLOWS THE FRAME
  // the write belongs to. Here B — an initialized boundary without `on` —
  // reads the SAME `data()` and holds the frame on it (A33), so for
  // `on={count()}` the frame waits for data and A's fallback is never shown:
  // held mid-flight, then the whole landing (DEV warns
  // LOADING_ON_OUTSIDE_HOLD: the fix is `latest()` in `on`, or moving B's
  // read under A). `on={latest(count)}` is that fix — a display-ahead read,
  // the fallback now, beside the held frame.
  //
  // `mounts` pins it — how many times A's `<Loading>` was created [after the
  // first landing, mid-flight, after the second landing]. Static and callback
  // children are re-evaluated by `Show` at the key change: one more mount,
  // mid-flight. `on` never remounts.
  // (A zero-arg function child is an accessor — evaluated once, not remounted
  // per key — and is deliberately not pinned here.)
  const matrix: Array<[Variant, string, [number, number, number], string[]]> = [
    ["show-static-latest", EARLY, [1, 2, 2], []],
    ["show-callback-latest", EARLY, [1, 2, 2], []],
    ["show-static-committed", HELD, [1, 2, 2], []],
    ["show-callback-committed", HELD, [1, 2, 2], []],
    ["on-committed", HELD, [0, 0, 0], ["LOADING_ON_OUTSIDE_HOLD"]],
    ["on-latest", EARLY, [0, 0, 0], []]
  ];
  for (const [variant, midFlight, expectedMounts, expectedCodes] of matrix) {
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
      const codes = captureDiagnostics();
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
      expect(codes()).toEqual(expectedCodes);
      dispose();
    });
  }
});

/** The held-action page: `label` and `count` written together inside an
 * action; A is `<Loading on>` reading `data(count)`, and nothing else reads
 * `data`. */
function heldActionPage(on: "committed" | "latest") {
  const div = document.createElement("div");
  let setCount!: (v: number) => void;
  let setLabel!: (v: string) => void;
  const dispose = render(() => {
    const [count, _setCount] = createSignal(1);
    const [label, _setLabel] = createSignal("old");
    setCount = _setCount;
    setLabel = _setLabel;
    const data = createMemo(async () => {
      const v = count();
      await delay(1000);
      return v;
    });
    return (
      <>
        <p>Label: {label()}</p>
        <p>Count: {count()}</p>
        <p>
          A:{" "}
          <Loading on={on === "latest" ? latest(count) : count()} fallback="Loading A">
            {data()}
          </Loading>
        </p>
      </>
    );
  }, div);
  const save = () => {
    let release!: () => void;
    action(function* () {
      setCount(2);
      setLabel("new");
      yield new Promise<void>(r => (release = r));
    })();
    flush();
    return async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
      flush();
    };
  };
  return { div, dispose, save };
}

describe("Loading `on` follows the frame (#3540)", () => {
  test("a dependency written inside a held action: the DOM holds the old page, and the fallback lands WITH the commit", async () => {
    const { div, dispose, save } = heldActionPage("committed");
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(div.textContent).toBe("Label: oldCount: 1A: 1");

    // The action holds the frame: count, label and A's fallback are all its.
    // The boundary released its hold (the frame no longer waits for data),
    // but the swap is staged with count's write — nothing on screen changes.
    // (The trigger shape this replaces showed `Loading A` here, beside a
    // `Count: 1` the change had not reached yet.)
    const release = save();
    expect(div.textContent).toBe("Label: oldCount: 1A: 1");

    // The action ends while data is still up: the batch commits — the new
    // label and count, and the fallback, together in one frame.
    await release();
    expect(div.textContent).toBe("Label: newCount: 2A: Loading A");

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(div.textContent).toBe("Label: newCount: 2A: 2");
    dispose();
  });

  test("the action outlasts the data: no fallback is ever shown; DEV warns LOADING_ON_OUTSIDE_HOLD", async () => {
    const { div, dispose, save } = heldActionPage("committed");
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    const codes = captureDiagnostics();

    // Data lands while the action still parks the frame: the staged swap is
    // cleared before it is ever displayed, and the commit shows the content
    // directly. Nothing outside A reads data, so this is the after-the-fact
    // rule, reported once when the content settles.
    const release = save();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(div.textContent).toBe("Label: oldCount: 1A: 1");
    expect(codes()).toEqual(["LOADING_ON_OUTSIDE_HOLD"]);

    await release();
    expect(div.textContent).toBe("Label: newCount: 2A: 2");
    dispose();
  });

  test("`on={latest(count)}` inside the same held action: the fallback now, beside the held DOM", async () => {
    const { div, dispose, save } = heldActionPage("latest");
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(div.textContent).toBe("Label: oldCount: 1A: 1");

    // A display-ahead read: the user asked for the change now, so the swap
    // is the current frame's — the fallback beside the still-held label and
    // count (the pre-frame-following shape, by choice).
    const release = save();
    expect(div.textContent).toBe("Label: oldCount: 1A: Loading A");

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(div.textContent).toBe("Label: oldCount: 1A: Loading A");

    await release();
    expect(div.textContent).toBe("Label: newCount: 2A: 2");
    dispose();
  });

  test("a mainline write with nothing else holding the frame: the fallback lands with the write, now", async () => {
    const div = document.createElement("div");
    let setCount!: (v: number) => void;
    const dispose = render(() => {
      const [count, _setCount] = createSignal(1);
      setCount = _setCount;
      const data = createMemo(async () => {
        const v = count();
        await delay(1000);
        return v;
      });
      return (
        <>
          <p>Count: {count()}</p>
          <p>
            A:{" "}
            <Loading on={count()} fallback="Loading A">
              {data()}
            </Loading>
          </p>
        </>
      );
    }, div);
    flush();
    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(div.textContent).toBe("Count: 1A: 1");

    // The boundary released its hold and nothing else waits on data: the
    // frame commits in this pass — the new count and the fallback together.
    setCount(2);
    flush();
    expect(div.textContent).toBe("Count: 2A: Loading A");

    await vi.advanceTimersByTimeAsync(1000);
    flush();
    expect(div.textContent).toBe("Count: 2A: 2");
    dispose();
  });
});

describe("Errored `on` retries on a dependency (#3540)", () => {
  // Unchanged by frame-following: a retry is a recompute, not a display
  // write — it runs mainline (content now, an action's other writes later).
  test("a change to a dependency while the error fallback shows clears the error and retries the children", () => {
    const div = document.createElement("div");
    let broken = true;
    let setRetryKey!: (v: number) => void;
    let attempts = 0;
    const dispose = render(() => {
      const [retryKey, _set] = createSignal(0);
      setRetryKey = _set;
      const Content = () => {
        const value = createMemo(() => {
          attempts++;
          if (broken) throw new Error("boom");
          return "content";
        });
        return <span>{value()}</span>;
      };
      return (
        <Errored
          fallback={(err: () => unknown) => <i>{(err() as Error).message}</i>}
          on={retryKey()}
        >
          <Content />
        </Errored>
      );
    }, div);
    flush();
    expect(div.textContent).toBe("boom");
    expect(attempts).toBe(1);

    setRetryKey(1);
    flush();
    expect(div.textContent).toBe("boom");
    expect(attempts).toBe(2);

    broken = false;
    setRetryKey(2);
    flush();
    expect(div.textContent).toBe("content");
    expect(attempts).toBe(3);

    setRetryKey(3);
    flush();
    expect(div.textContent).toBe("content");
    expect(attempts).toBe(3);
    dispose();
  });
});
