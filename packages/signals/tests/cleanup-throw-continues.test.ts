// A cleanup that throws does not abort the rest of the teardown: every
// cleanup still runs — the ones registered before it on the same owner, the
// siblings and ancestors the walk had not reached, effect cleanups — and the
// first error is rethrown once the teardown is over. A teardown inside a flush
// (a commit retiring a frame, a pass replacing one, an effect disposing a
// root) leaves it for the end of the flush, so the flush is never left
// half-applied.
import {
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  isDisposed,
  onCleanup,
  resetErrorHalt,
  type Owner
} from "../src/index.js";

afterEach(() => {
  resetErrorHalt();
  flush();
});

const boom = (message = "boom") => {
  throw new Error(message);
};

describe("root dispose", () => {
  it("runs every cleanup in the tree and rethrows the first error after", () => {
    const log: string[] = [];
    let inner!: Owner;
    let sibling!: Owner;
    const dispose = createRoot(dispose => {
      onCleanup(() => log.push("root"));
      createRoot(() => {
        inner = getOwner()!;
        onCleanup(() => log.push("inner first"));
        createRenderEffect(
          () => 1,
          () => () => log.push("effect cleanup")
        );
        onCleanup(() => boom("first error"));
        onCleanup(() => log.push("inner last"));
      });
      createRoot(() => {
        sibling = getOwner()!;
        onCleanup(() => boom("second error"));
        onCleanup(() => log.push("sibling"));
      });
      return dispose;
    });
    flush();

    // Children go newest first, so the sibling's error is the first thrown.
    expect(dispose).toThrow("second error");
    // Unwind order is kept (children, then the owner's own cleanups, latest
    // first); nothing is skipped.
    expect(log).toEqual(["sibling", "effect cleanup", "inner last", "inner first", "root"]);
    expect(isDisposed(inner)).toBe(true);
    expect(isDisposed(sibling)).toBe(true);
  });

  it("rethrows once: a later teardown does not see the error again", () => {
    const first = createRoot(dispose => {
      onCleanup(() => boom());
      return dispose;
    });
    const second = createRoot(dispose => {
      onCleanup(() => {});
      return dispose;
    });
    expect(first).toThrow("boom");
    expect(second).not.toThrow();
    expect(() => flush()).not.toThrow();
  });

  it("a throwing effect cleanup does not stop the owner's own cleanups", () => {
    const log: string[] = [];
    const dispose = createRoot(dispose => {
      onCleanup(() => log.push("owner"));
      createEffect(
        () => 1,
        () => () => boom()
      );
      return dispose;
    });
    flush();
    expect(dispose).toThrow("boom");
    expect(log).toEqual(["owner"]);
  });
});

describe("inside a flush", () => {
  it("a branch switch runs every cleanup of the old frame, commits, then the flush throws", () => {
    const log: string[] = [];
    const seen: string[] = [];
    const [show, setShow] = createSignal(true);
    const dispose = createRoot(dispose => {
      const view = createMemo(() => {
        if (!show()) return "off";
        onCleanup(() => log.push("first"));
        createRenderEffect(
          () => 1,
          () => () => log.push("effect cleanup")
        );
        onCleanup(() => boom());
        return "on";
      });
      createRenderEffect(view, v => void seen.push(v));
      return dispose;
    });
    flush();

    setShow(false);
    expect(() => flush()).toThrow("boom");
    expect(log).toEqual(["effect cleanup", "first"]);
    // The flush completed before rethrowing: the new branch is on screen.
    expect(seen).toEqual(["on", "off"]);

    // No latch, and nothing left half-applied: later flushes are clean.
    expect(() => flush()).not.toThrow();
    setShow(true);
    flush();
    expect(seen).toEqual(["on", "off", "on"]);
    expect(dispose).toThrow("boom");
    expect(log).toEqual(["effect cleanup", "first", "effect cleanup", "first"]);
  });

  it("an error boundary's content moves on; the error surfaces from the flush", () => {
    const seen: unknown[] = [];
    const [show, setShow] = createSignal(true);
    const dispose = createRoot(dispose => {
      const out = createErrorBoundary(
        () => {
          const view = createMemo(() => {
            if (!show()) return "off";
            onCleanup(() => boom());
            return "on";
          });
          return view();
        },
        () => "fallback"
      );
      createRenderEffect(out, v => void seen.push(v));
      return dispose;
    });
    flush();
    setShow(false);
    expect(() => flush()).toThrow("boom");
    expect(seen).toEqual(["on", "off"]);
    dispose();
  });

  it("scheduling keeps working after the flush rethrew", async () => {
    const [count, setCount] = createSignal(0);
    const [show, setShow] = createSignal(true);
    const seen: number[] = [];
    const dispose = createRoot(dispose => {
      createMemo(() => {
        if (show()) onCleanup(() => boom());
      });
      createRenderEffect(count, v => void seen.push(v));
      return dispose;
    });
    flush();
    setShow(false);
    expect(() => flush()).toThrow("boom");

    // The automatic (microtask) flush still runs.
    setCount(1);
    await Promise.resolve();
    expect(seen).toEqual([0, 1]);
    dispose();
  });

  it("a root disposed by an effect: the effect continues, the flush rethrows at its end", () => {
    const log: string[] = [];
    const [go, setGo] = createSignal(false);
    const disposeOther = createRoot(dispose => {
      onCleanup(() => log.push("other first"));
      onCleanup(() => boom());
      return dispose;
    });
    const dispose = createRoot(dispose => {
      createEffect(go, v => {
        if (!v) return;
        disposeOther();
        log.push("after dispose");
      });
      return dispose;
    });
    flush();
    setGo(true);
    expect(() => flush()).toThrow("boom");
    expect(log).toEqual(["other first", "after dispose"]);
    dispose();
  });

  it("a lazy node released mid-walk does not rethrow before the walk is done", () => {
    const log: string[] = [];
    let lazy!: () => number;
    const disposeSource = createRoot(dispose => {
      lazy = createMemo(
        () => {
          onCleanup(() => log.push("lazy"));
          return 1;
        },
        { lazy: true }
      );
      return dispose;
    });
    const dispose = createRoot(dispose => {
      onCleanup(() => log.push("root"));
      // Disposed after the effect below (children go newest first)...
      createRoot(() => {
        onCleanup(() => log.push("child"));
      });
      // ...and this one first, so its error is collected before the effect's
      // teardown releases `lazy` through `unobserved`.
      createRenderEffect(lazy, () => {});
      createRoot(() => {
        onCleanup(() => boom());
      });
      return dispose;
    });
    flush();

    expect(dispose).toThrow("boom");
    expect(log).toEqual(["lazy", "child", "root"]);
    disposeSource();
  });

  it("a halt drops a collected cleanup error: a later dispose does not throw it", () => {
    const [go, setGo] = createSignal(false);
    const disposeOther = createRoot(dispose => {
      onCleanup(() => boom("cleanup"));
      return dispose;
    });
    const dispose = createRoot(dispose => {
      createEffect(go, v => {
        if (v) disposeOther();
      });
      createEffect(go, v => {
        if (v) boom("effect");
      });
      return dispose;
    });
    flush();
    setGo(true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => flush()).toThrow("effect");
    } finally {
      error.mockRestore();
    }
    const unrelated = createRoot(dispose => dispose);
    expect(unrelated).not.toThrow();
    resetErrorHalt();
    dispose();
  });
});

describe("unobserved hooks", () => {
  it("a throwing hook does not stop the teardown around it", () => {
    const log: string[] = [];
    let source!: () => number;
    const disposeSource = createRoot(dispose => {
      source = createMemo(() => 1, {
        lazy: true,
        unobserved: () => {
          log.push("hook");
          boom("hook");
        }
      });
      return dispose;
    });
    const dispose = createRoot(dispose => {
      createRenderEffect(source, () => {});
      onCleanup(() => log.push("root"));
      return dispose;
    });
    flush();

    expect(dispose).toThrow("hook");
    expect(log).toEqual(["hook", "root"]);
    disposeSource();
  });
});
