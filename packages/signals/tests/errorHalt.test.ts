import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  resetErrorHalt
} from "../src/index.js";

// An error that escapes every boundary permanently halts the reactive system
// (#2761/#2762): app state is undefined after an uncaught error, so instead of
// limping along with half-applied updates the scheduler stops accepting work.
describe("uncaught effect errors halt the reactive system", () => {
  afterEach(() => {
    resetErrorHalt();
    vi.restoreAllMocks();
  });

  it("halts scheduling after an uncaught user effect error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, setA] = createSignal(0);
    const [c, setC] = createSignal(0);
    const seenC: number[] = [];

    createRoot(() => {
      createEffect(a, v => {
        if (v === 1) throw new Error("boom");
      });
      createEffect(c, v => {
        seenC.push(v);
      });
    });
    flush();
    seenC.length = 0;

    expect(() => {
      setA(1);
      flush();
    }).toThrow("boom");
    expect(error.mock.calls.some(args => /REACTIVITY_HALTED/.test(String(args[0])))).toBe(true);

    // The system is dead: writes are ignored on both the sync and microtask paths.
    setC(3);
    flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(seenC).toEqual([]);
  });

  it("flush() after a halt is a no-op rather than a throw", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, setA] = createSignal(0);

    createRoot(() => {
      createEffect(a, v => {
        if (v === 1) throw new Error("boom");
      });
    });
    flush();

    expect(() => {
      setA(1);
      flush();
    }).toThrow("boom");
    expect(() => flush()).not.toThrow();
  });

  it("resetErrorHalt revives scheduling", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, setA] = createSignal(0);
    const [c, setC] = createSignal(0);
    const seenC: number[] = [];

    createRoot(() => {
      createEffect(a, v => {
        if (v === 1) throw new Error("boom");
      });
      createEffect(c, v => {
        seenC.push(v);
      });
    });
    flush();
    seenC.length = 0;

    expect(() => {
      setA(1);
      flush();
    }).toThrow("boom");

    resetErrorHalt();
    setC(3);
    flush();
    expect(seenC).toEqual([3]);
  });

  it("does not halt when an error boundary handles the error", () => {
    const [a, setA] = createSignal(0);
    const [c, setC] = createSignal(0);
    const seenC: number[] = [];
    let errored: unknown;

    createRoot(() => {
      createErrorBoundary(
        () => {
          createEffect(a, v => {
            if (v === 1) throw new Error("boom");
          });
        },
        err => {
          errored = err();
        }
      )();
      createEffect(c, v => {
        seenC.push(v);
      });
    });
    flush();
    seenC.length = 0;

    setA(1);
    flush();
    expect(String(errored)).toContain("boom");

    setC(3);
    flush();
    expect(seenC).toEqual([3]);
  });

  it("halts after an uncaught tracked effect error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, setA] = createSignal(0);
    const [c, setC] = createSignal(0);
    const seenC: number[] = [];

    createRoot(() => {
      createTrackedEffect(() => {
        if (a() === 1) throw new Error("tracked boom");
      });
      createEffect(c, v => {
        seenC.push(v);
      });
    });
    flush();
    seenC.length = 0;

    expect(() => {
      setA(1);
      flush();
    }).toThrow("tracked boom");

    setC(3);
    flush();
    expect(seenC).toEqual([]);
  });

  it("logs the causing error alongside REACTIVITY_HALTED (#2884)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, setA] = createSignal(0);

    createRoot(() => {
      createEffect(a, v => {
        if (v === 1) throw new Error("halt cause");
      });
    });
    flush();

    expect(() => {
      setA(1);
      flush();
    }).toThrow("halt cause");
    const haltCall = error.mock.calls.find(args => /REACTIVITY_HALTED/.test(String(args[0])));
    expect(haltCall).toBeDefined();
    expect(haltCall![1]).toBeInstanceOf(Error);
    expect((haltCall![1] as Error).message).toBe("halt cause");
  });

  it("a Loading boundary cannot silently swallow an unhandled error (#2884)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // A nested render effect whose creation throws routes the error into the
    // boundary tree as status. A Loading boundary only collects PENDING; the
    // ERROR dimension forwards up unhandled, and the boundary's foreign-status
    // scrub (#2809) used to erase it entirely — no log, no throw.
    expect(() =>
      createRoot(() => {
        createLoadingBoundary(
          () => {
            createRenderEffect(
              () => {
                throw new Error("swallowed boom");
              },
              () => {}
            );
            return "content";
          },
          () => "loading"
        )();
      })
    ).toThrow("swallowed boom");

    const haltCall = error.mock.calls.find(args => /REACTIVITY_HALTED/.test(String(args[0])));
    expect(haltCall).toBeDefined();
    expect((haltCall![1] as Error).message).toBe("swallowed boom");
  });

  it("detaches a throwing cleanup so it never re-fires (#2813)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [n, setN] = createSignal(0);
    const bodyRuns: number[] = [];
    const cleanupRuns: number[] = [];

    createRoot(() => {
      createEffect(n, v => {
        bodyRuns.push(v);
        return () => {
          cleanupRuns.push(v);
          if (v === 0) throw new Error("cleanup boom");
        };
      });
    });
    flush();
    expect(bodyRuns).toEqual([0]);

    expect(() => {
      setN(1);
      flush();
    }).toThrow("cleanup boom");

    // The throwing cleanup was detached before it ran; after a revive the
    // effect works again and the stale cleanup does not re-fire.
    resetErrorHalt();
    setN(2);
    flush();
    expect(cleanupRuns.filter(v => v === 0)).toHaveLength(1);
    expect(bodyRuns).toContain(2);
  });
});
