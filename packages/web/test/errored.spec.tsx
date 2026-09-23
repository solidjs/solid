/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import {
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  Errored,
  Loading,
  Show,
  isPending,
  flush
} from "solid-js";
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
 * A function-valued `fallback` is resolved by `<Errored>` itself, inside the
 * boundary's own scope, whatever its arity — like `<Show>` resolving a
 * function child inside its own memo. A zero-arity thunk
 * (`fallback={() => <F />}`, type-reachable since `() => X` is assignable to
 * `(err, reset) => X`) used to be handed back unresolved for the consuming
 * hole to build on the enclosing owner, which permuted hydration keys when a
 * scoped hole followed the boundary (#3620). Pins the client semantics the
 * change must keep: the two-arity form is untouched, a zero-arity fallback
 * that reads signals still re-renders, reset still recovers, and the
 * fallback's owner is the boundary's, not the hole's.
 */
describe("Errored function-valued fallback resolves inside the boundary", () => {
  const Throws = (): never => {
    throw new Error("Failure");
  };

  test("zero-arity fallback thunk renders", () => {
    const div = document.createElement("div");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const dispose = render(
      () => (
        <Errored fallback={() => <b>fell</b>}>
          <Throws />
        </Errored>
      ),
      div
    );
    flush();
    expect(div.innerHTML).toBe("<b>fell</b>");
    // Dev logs the error a fallback cannot see (a value or a zero-arity thunk).
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "Failure" }));
    error.mockRestore();
    dispose();
  });

  test("zero-arity fallback that reads a signal re-renders when it changes", () => {
    const div = document.createElement("div");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const [count, setCount] = createSignal(0);
    let runs = 0;
    const dispose = render(
      () => (
        <Errored
          fallback={() => {
            runs++;
            // Read in the fallback body itself — not through a compiled hole —
            // so the re-render is the boundary's, not a text effect's.
            return count() > 0 ? <b>many {count()}</b> : <i>none</i>;
          }}
        >
          <Throws />
        </Errored>
      ),
      div
    );
    flush();
    expect(div.innerHTML).toBe("<i>none</i>");
    expect(runs).toBe(1);
    setCount(2);
    flush();
    expect(div.innerHTML).toBe("<b>many 2</b>");
    expect(runs).toBe(2);
    setCount(3);
    flush();
    expect(div.innerHTML).toBe("<b>many 3</b>");
    error.mockRestore();
    dispose();
  });

  test("zero-arity fallback runs under the boundary's owner, not the consuming hole's", () => {
    const div = document.createElement("div");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    type O = ReturnType<typeof getOwner>;
    let zeroParent: O = null,
      zeroFallbackOwner: O = null;
    let twoParent: O = null,
      twoFallbackOwner: O = null;
    // Each component returns its boundary directly (no conditional memo in
    // between), so the boundary's nodes hang off the component owner.
    const Zero = () => {
      zeroParent = getOwner();
      return (
        <Errored
          fallback={() => {
            zeroFallbackOwner = getOwner();
            return <b>fell</b>;
          }}
        >
          <Throws />
        </Errored>
      );
    };
    const Two = () => {
      twoParent = getOwner();
      return (
        <Errored
          fallback={(_err, _reset) => {
            twoFallbackOwner = getOwner();
            return <b>fell</b>;
          }}
        >
          <Throws />
        </Errored>
      );
    };
    const dispose = render(
      () => (
        <section>
          <Zero />
          <Two />
        </section>
      ),
      div
    );
    flush();
    expect(div.textContent).toBe("fellfell");
    // Both fallbacks ran under a node the boundary created below the
    // component owner — its output computed — at the same depth, not under
    // the insert effect of the hole that consumes the boundary (a child of
    // the render root, not of the component). Hops from the fallback's owner
    // up to the component owner; -1 when the component is not an ancestor.
    const hopsTo = (o: O, ancestor: O) => {
      for (let n: any = o, d = 0; n; n = n._parent, d++) if (n === ancestor) return d;
      return -1;
    };
    const zeroHops = hopsTo(zeroFallbackOwner, zeroParent);
    expect(zeroHops).toBeGreaterThan(0);
    expect(zeroHops).toBe(hopsTo(twoFallbackOwner, twoParent));
    error.mockRestore();
    dispose();
  });

  test("a rest-parameter fallback (length 0) still receives the error and reset", () => {
    const div = document.createElement("div");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let first = true;
    const Flaky = () => {
      if (first) {
        first = false;
        throw new Error("Failure");
      }
      return <b>ok</b>;
    };
    let reset: (() => void) | undefined;
    const dispose = render(
      () => (
        <Errored
          fallback={(...args: [() => unknown, () => void]) => {
            reset = args[1];
            return <i>{String(args[0]())}</i>;
          }}
        >
          <Flaky />
        </Errored>
      ),
      div
    );
    flush();
    expect(div.innerHTML).toBe("<i>Error: Failure</i>");
    reset!();
    flush();
    expect(div.innerHTML).toBe("<b>ok</b>");
    error.mockRestore();
    dispose();
  });

  test("two-arity fallback is unchanged: error accessor, reset, no dev error log", () => {
    const div = document.createElement("div");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let first = true;
    const Flaky = () => {
      if (first) {
        first = false;
        throw new Error("Failure");
      }
      return <b>ok</b>;
    };
    let reset: (() => void) | undefined;
    const dispose = render(
      () => (
        <Errored
          fallback={(err, r) => {
            reset = r;
            return <i>{String(err())}</i>;
          }}
        >
          <Flaky />
        </Errored>
      ),
      div
    );
    flush();
    expect(div.innerHTML).toBe("<i>Error: Failure</i>");
    expect(error).not.toHaveBeenCalled();
    reset!();
    flush();
    expect(div.innerHTML).toBe("<b>ok</b>");
    error.mockRestore();
    dispose();
  });
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
