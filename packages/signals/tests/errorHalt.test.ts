import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createMemo,
  createErrorBoundary,
  createLoadingBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  getOwner,
  OBSERVE,
  resetErrorHalt
} from "../src/index.js";

// An error that escapes every boundary permanently halts the reactive system
// (#2761/#2762): app state is undefined after an uncaught error, so instead of
// limping along with half-applied updates the scheduler stops accepting work.
describe("uncaught effect errors halt the reactive system (A5)", () => {
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

  // #3338: a creation-time throw is converted to status by ancestor recomputes
  // and never reaches the top, so console.error was the only trace of a halt.
  // Where the platform has an uncaught-error channel, the cause goes through it.
  it("hands the cause to reportError where the platform provides one", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const reported: unknown[] = [];
    (globalThis as any).reportError = (e: unknown) => reported.push(e);
    try {
      const boom = new Error("boom");
      const [a, setA] = createSignal(0);
      createRoot(() => {
        createEffect(a, v => {
          if (v === 1) throw boom;
        });
      });
      flush();
      expect(() => {
        setA(1);
        flush();
      }).toThrow("boom");
      expect(reported).toEqual([boom]);
      // The halt notice itself still logs (the tests above key on it), but the
      // cause is not double-logged next to it.
      const halt = error.mock.calls.filter(args => /REACTIVITY_HALTED/.test(String(args[0])));
      expect(halt).toHaveLength(1);
      expect(halt[0]).toHaveLength(1);
    } finally {
      delete (globalThis as any).reportError;
    }
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

// #4178: the halt freezes the whole app, so its message has to say WHERE the
// uncaught error escaped — the owner path of the computation that threw, the
// same `in <App> › …` line every other diagnostic prints — on the halt itself
// and on the "Update ignored" notice a later write logs.
describe("REACTIVITY_HALTED names where it happened (#4178)", () => {
  afterEach(() => {
    resetErrorHalt();
    vi.restoreAllMocks();
  });

  const nameOwner = (name: string) => ((getOwner() as any)._name = name);
  const haltLines = (error: { mock: { calls: unknown[][] } }) =>
    error.mock.calls.map(args => String(args[0])).filter(m => /REACTIVITY_HALTED/.test(m));

  it("locates an effect-callback throw at the effect's owner path", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    createRoot(() => {
      nameOwner("<App>");
      createRoot(() => {
        nameOwner("<Composer>");
        createEffect(
          a,
          v => {
            if (v === 1) throw new Error("boom");
          },
          { name: "syncDraft" }
        );
      });
      createEffect(b, () => {});
    });
    flush();

    expect(() => {
      setA(1);
      flush();
    }).toThrow("boom");
    setB(1);
    flush();

    const [halt, ignored] = haltLines(error);
    expect(halt).toContain("Handle errors with <Errored> or treat this as a crash.");
    expect(halt).toContain("\n  in <App> › <Composer> › syncDraft");
    expect(ignored).toBe(
      "[REACTIVITY_HALTED] Update ignored: the reactive system was halted by an earlier uncaught error." +
        "\n  in <App> › <Composer> › syncDraft"
    );
  });

  it("locates a computed's throw at the computed, not the effect reading it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, setA] = createSignal(0);
    createRoot(() => {
      nameOwner("<App>");
      const derived = createMemo(
        () => {
          if (a() === 1) throw new Error("bad derive");
          return a();
        },
        { name: "derived" }
      );
      createRenderEffect(derived, () => {}, { name: "view" });
    });
    flush();

    expect(() => {
      setA(1);
      flush();
    }).toThrow("bad derive");
    const [halt] = haltLines(error);
    expect(halt).toContain("\n  in <App> › derived");
    expect(halt).not.toContain("view");
  });

  it("carries the path on the structured event too", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const events: any[] = [];
    const unsubscribe = OBSERVE!.diagnostics.subscribe(event => events.push(event));
    try {
      const [a, setA] = createSignal(0);
      createRoot(() => {
        nameOwner("<Widget>");
        createEffect(a, v => {
          if (v === 1) throw new Error("boom");
        });
      });
      flush();
      expect(() => {
        setA(1);
        flush();
      }).toThrow("boom");
    } finally {
      unsubscribe();
    }
    const halt = events.find(e => e.code === "REACTIVITY_HALTED");
    expect(halt.ownerPath).toEqual(["<Widget>", "effect"]);
  });

  it("names an unlabelled effect by its default name", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
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
    const [halt] = haltLines(error);
    expect(halt).toBe(
      "[REACTIVITY_HALTED] An uncaught error halted the reactive system. No further updates will be processed. Handle errors with <Errored> or treat this as a crash." +
        "\n  in effect"
    );
  });
});
