// #3601: an `onCleanup` callback ran twice when it disposed its root during a
// memo's recomputation.
//
// A rerun's `disposeChildren(el)` → `runDisposal(el)` iterates `el._disposal`
// and only nulls it AFTER the loop. A cleanup that calls the root's `dispose()`
// re-enters `disposeChildren(root, true)`, whose walk reaches `el` again while
// the same array is still attached — and runs every entry a second time.

import {
  action,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  onCleanup,
  resetErrorHalt
} from "../src/index.js";

afterEach(() => {
  flush();
  resetErrorHalt();
});

describe("#3601 onCleanup disposing the root during memo recomputation", () => {
  it("runs the cleanup exactly once (issue repro)", () => {
    const [version, setVersion] = createSignal(0);
    let cleanups = 0;

    createRoot(dispose => {
      const memo = createMemo(() => {
        const current = version();
        if (current === 0) {
          onCleanup(() => {
            cleanups++;
            dispose();
          });
        }
        return current;
      });
      createEffect(memo, () => {});
    });

    flush();
    setVersion(1);
    flush();
    expect(cleanups).toBe(1);
  });

  it("with several registered cleanups, each runs once, in unwind order (#3572)", () => {
    const [version, setVersion] = createSignal(0);
    const log: string[] = [];

    createRoot(dispose => {
      const memo = createMemo(() => {
        const current = version();
        if (current === 0) {
          onCleanup(() => log.push("a"));
          onCleanup(() => {
            log.push("b");
            dispose();
          });
          onCleanup(() => log.push("c"));
        }
        return current;
      });
      createEffect(memo, () => {});
      onCleanup(() => log.push("root"));
    });

    flush();
    setVersion(1);
    flush();
    expect(log).toEqual(["c", "b", "root", "a"]);
  });

  it("effect twin: a compute-phase cleanup disposing the root runs once", () => {
    const [version, setVersion] = createSignal(0);
    let cleanups = 0;

    createRoot(dispose => {
      createEffect(
        () => {
          const current = version();
          if (current === 0) {
            onCleanup(() => {
              cleanups++;
              dispose();
            });
          }
          return current;
        },
        () => {}
      );
    });

    flush();
    setVersion(1);
    flush();
    expect(cleanups).toBe(1);
  });

  it("held-children twin: a rerun under a hold drains `_disposal` directly — still once", async () => {
    // An uncommitted pass's registrations (CONFIG_HELD_CHILDREN) die
    // immediately on the next rerun via `disposeChildren(el)` — the same
    // cleared-after-the-loop shape on the `_disposal` slot instead of the
    // parked frame's `_pendingDisposal`. This path predates #3592.
    let setVisible!: (v: boolean) => void;
    let setTick!: (v: number) => void;
    let cleanups = 0;
    const pending = Promise.withResolvers<void>();

    createRoot(dispose => {
      const [visible, sv] = createSignal(true);
      const [tick, st] = createSignal(0);
      setVisible = sv;
      setTick = st;
      const branch = createMemo(() => {
        tick();
        if (visible()) return true;
        // registered by the held pass, drained by the next held rerun
        onCleanup(() => {
          cleanups++;
          dispose();
        });
        return false;
      });
      createEffect(branch, () => {});
    });
    flush();

    const changed = action(function* () {
      setVisible(false);
      yield Promise.resolve();
      setTick(1);
      yield pending.promise;
    })();
    flush();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
    expect(cleanups).toBe(1);

    pending.resolve();
    await changed;
    flush();
    expect(cleanups).toBe(1);
  });

  it("a throwing compute-phase cleanup does not latch: later flushes are clean", () => {
    // Same shape as #2813's `_cleanup` ruling, on the `_disposal` list: the
    // thrower is detached before it runs, so it fires once and never again.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [version, setVersion] = createSignal(0);
    let runs = 0;

    createRoot(() => {
      const memo = createMemo(() => {
        const current = version();
        if (current === 0) {
          onCleanup(() => {
            runs++;
            throw new Error("cleanup boom");
          });
        }
        return current;
      });
      createEffect(memo, () => {});
    });

    flush();
    expect(() => {
      setVersion(1);
      flush();
    }).toThrow("cleanup boom");
    expect(runs).toBe(1);

    // Unpatched, the list survived the throw and every later flush re-ran
    // and re-threw it. The entry must be gone.
    resetErrorHalt();
    setVersion(2);
    flush();
    setVersion(3);
    flush();
    expect(runs).toBe(1);
  });
});
