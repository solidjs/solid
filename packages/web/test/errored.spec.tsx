/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createMemo, createRoot, Errored, Loading, Show, isPending, flush } from "solid-js";
import { render } from "../src/index.js";

describe("Testing Errored control flow", () => {
  let div!: HTMLDivElement, disposer: () => void;

  const Component = () => {
    throw new Error("Failure");
  };

  let first = true;
  const Component2 = () => {
    if (first) {
      first = false;
      throw new Error("Failure");
    }
    return "Success";
  };

  const Component3 = () => {
    throw null;
  };

  test("Create an Error", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <Errored fallback="Failed Miserably">
          <Component />
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("Create an Error with null", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <Errored fallback="Failed Miserably">
          <Component3 />
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("Create an Error callback", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <Errored fallback={e => String(e())}>
          <Component />
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Error: Failure");
  });

  test("Create an Error callback and reset", () => {
    let r: () => void;
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <Errored
          fallback={(e, reset) => {
            r = reset;
            return String(e());
          }}
        >
          <Component2 />
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Error: Failure");
    flush();

    r!();
    flush();
    expect(div.innerHTML).toBe("Success");
    first = true;
  });

  test("Create an Error in an Error Fallback", () => {
    createRoot(dispose => {
      disposer = dispose;
      <div ref={div}>
        <Errored fallback="Failed Miserably">
          <Errored fallback={<Component />}>
            <Component />
          </Errored>
        </Errored>
      </div>;
    });
    expect(div.innerHTML).toBe("Failed Miserably");
  });

  test("dispose", () => disposer());
});

/**
 * #2790: `isPending(data)` inside a `<Show>` in the `<Errored>` fallback, where
 * the async `data` fails again after `reset()`.
 *
 * An `isPending(data)` read subscribes the reader (here the `<Show>` condition)
 * to `data`. When `data` re-errors after `reset()`, the STATUS_ERROR
 * notification used to travel back through that link, which both (a) re-ran the
 * reader so it re-read the errored source and re-armed the retry, livelocking,
 * and (b) rethrew out of the fallback subtree (a boundary cannot catch an error
 * from its own fallback), surfacing as an unhandled rejection. The fix tags the
 * `isPending` link as a pending-observer (so `notifyStatus` re-runs the reader
 * instead of forwarding the error) and gates the errored-retry in `read` so a
 * pending-check observes the errored status rather than re-fetching it.
 */
describe("isPending in Loading > Errored fallback (#2790)", () => {
  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  test("no infinite loop when the source fails again after reset", async () => {
    const div = document.createElement("div");
    let current = deferred<string>();
    let resetFn: (() => void) | undefined;
    let fallbackRuns = 0;

    const data = createMemo(async () => {
      await current.promise;
      return "ok";
    });

    const dispose = render(
      () => (
        <Loading fallback={<div>loading</div>}>
          <Errored
            fallback={(err, reset) => {
              resetFn = reset;
              if (++fallbackRuns > 100) throw new Error("INFINITE_LOOP runs=" + fallbackRuns);
              return (
                <div>
                  <span>err:{String((err() as any)?.message ?? err())}</span>
                  <Show when={isPending(data)}>
                    <span>resetting</span>
                  </Show>
                </div>
              );
            }}
          >
            <div>{data()}</div>
          </Errored>
        </Loading>
      ),
      div
    );

    flush();
    expect(div.textContent).toBe("loading");

    // first failure -> Errored fallback
    current.reject(new Error("boom1"));
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(div.textContent).toContain("err:boom1");

    // reset re-runs the errored source (advancing the clock so the errored async
    // looks stale); the refetch fails again -> previously livelocked / OOMed via
    // isPending's errored-retry.
    current = deferred<string>();
    resetFn!();
    flush();

    current.reject(new Error("boom2"));
    await Promise.resolve();
    await Promise.resolve();
    flush();

    await Promise.resolve();
    await Promise.resolve();
    expect(fallbackRuns).toBeLessThan(100);
    expect(div.textContent).toContain("err:boom2");
    // isPending(data) in the fallback observes the errored (not pending) source
    // and resolves to false: the `<Show>` renders nothing, no error escapes.
    expect(div.textContent).not.toContain("resetting");
    dispose();
  });
});
