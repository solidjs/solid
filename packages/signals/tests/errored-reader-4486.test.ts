import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  resetErrorHalt,
  untrack
} from "../src/index.js";

// Ruling (F-12, #4410 amendment of 2026-10-29, confirmed 2026-10-30 on
// #4486; D-42): a computation whose pass reads an ERRORED memo is errored
// with it whether or not its body catches the throw. An error is the upstream
// memo's status, not a throw the reader owns; recovery goes through
// `<Errored>` (D-39). The catch is inert — for errors only. A pass that
// catches a NotReadyError keeps today's behaviour (`try-catch-reactive-
// read.test.ts`, test 1).
//
// Deviation today (#4486): the catch wins on the creation pass and on the
// first re-run — the reader completes with its caught value and the error
// never reaches the boundary. The second re-run is `read()`'s clock-gated
// retry of the errored memo (core.ts, the errored-memo path: `tracking &&
// owner._time < clock` → `recompute(owner)`), which propagates the error from
// inside the reader's own pass: without a boundary the system halts, under one
// the boundary errors — with the reader still reading "caught".
//
// The fix exists: branch `fix/errored-reader-4486` (a per-pass flag set where
// the errored memo's error is thrown into the pass, rethrown when the pass
// completes with a value). It costs +83 B minified / +41 B brotli on the core
// floor and is not shipped: the deviation is reachable only through a catch
// the `CAUGHT_REACTIVE_READ` dev diagnostic (#4481) warns on, and without a
// catch the path is coherent — accepted 2026-10-30, #4486 closed. The ruled
// screens are pinned `it.fails` below so a core change that fixes it is
// noticed; the cases that hold on today's `next` are plain `it`.

async function settle() {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}

afterEach(() => {
  resetErrorHalt();
  vi.restoreAllMocks();
});

/** `bad` throws while `mode()` is 1; `catching` catches its read. */
function graph(initialMode = 1) {
  const [other, setOther] = createSignal(0);
  const [mode, setMode] = createSignal(initialMode);
  const runs: string[] = [];
  const bad = createMemo((): string => {
    if (mode() === 1) throw new Error("boom");
    return `m${mode()}`;
  });
  const catching = createMemo(() => {
    other();
    runs.push("run");
    try {
      return bad();
    } catch (e) {
      runs.push(`caught:${(e as Error).message}`);
      return "caught";
    }
  });
  return { bad, catching, setOther, setMode, runs };
}

function mountUnderBoundary(initialMode = 1) {
  const screens: string[] = [];
  let g!: ReturnType<typeof graph>;
  createRoot(() => {
    g = graph(initialMode);
    const out = createErrorBoundary(
      () => g.catching(),
      e => `errored:${(e() as Error).message}`
    );
    createRenderEffect(out, v => void screens.push(v));
  });
  flush();
  return { g, screens };
}

describe("a reader of an errored memo is errored with it, whether or not it catches (#4486)", () => {
  describe("the ruled screens — pinned `it.fails` until the fix ships", () => {
    // Today: `["caught"]` at the mount and after `setOther(1)`;
    // `["caught", "errored:boom"]` after `setOther(2)`.
    it.fails(
      "under <Errored>: the boundary shows the error from the mount on, never 'caught'",
      () => {
        const { g, screens } = mountUnderBoundary();
        // The catch ran — and changed nothing: the pass is errored with `bad`.
        expect(g.runs).toEqual(["run", "caught:boom"]);
        expect(screens).toEqual(["errored:boom"]);

        g.setOther(1);
        flush();
        expect(screens).toEqual(["errored:boom"]);

        g.setOther(2);
        flush();
        expect(screens).toEqual(["errored:boom"]);
      }
    );

    // Today: `catching()` returns "caught".
    it.fails(
      "an errored reader throws for an untracked read too (D-39): `catching()` is not 'caught'",
      () => {
        const { g } = mountUnderBoundary();
        expect(() => g.catching()).toThrow("boom");
        g.setOther(1);
        flush();
        expect(() => g.catching()).toThrow("boom");
      }
    );

    // Today: the mount completes, the effect shows "caught", and the halt
    // comes on the second re-run (`setOther(2)`).
    it.fails(
      "without a boundary: the error escapes at the mount — REACTIVITY_HALTED — not on a later re-run",
      () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const screens: string[] = [];
        let g!: ReturnType<typeof graph>;
        // The halt rethrows the escaping error out of the mount (D-38).
        expect(() =>
          createRoot(() => {
            g = graph();
            createRenderEffect(g.catching, v => void screens.push(v));
          })
        ).toThrow("boom");
        flush();
        expect(screens).toEqual([]);
        expect(error.mock.calls.map(c => String(c[0]))).toEqual([
          expect.stringContaining(
            "[REACTIVITY_HALTED] An uncaught error halted the reactive system"
          )
        ]);
        expect(String(error.mock.calls[0][1])).toContain("boom");
        g.setOther(1);
        flush();
        expect(error.mock.calls.map(c => String(c[0]))[1]).toContain("Update ignored");
      }
    );

    // Today: the re-run over the already-errored source completes with
    // "caught" (the screen stays "errored:boom" only because the boundary
    // already shows it — D-41 — and `catching()` reads "caught").
    it.fails(
      "the outcome does not depend on the clock: a re-run onto a source that erred in an earlier flush is errored too",
      () => {
        const { g, screens } = mountUnderBoundary(0);
        expect(screens).toEqual(["m0"]);
        g.setMode(1);
        flush();
        expect(screens).toEqual(["m0", "errored:boom"]);
        expect(g.runs).toEqual(["run"]);
        // Re-run over the already-errored source, in a later flush: the catch
        // runs and the pass is errored all the same — the same screen as the
        // creation pass over an errored source gives.
        g.setOther(1);
        flush();
        expect(g.runs).toEqual(["run", "run", "caught:boom"]);
        expect(screens).toEqual(["m0", "errored:boom"]);
        expect(() => g.catching()).toThrow("boom");
        g.setOther(2);
        flush();
        expect(screens).toEqual(["m0", "errored:boom"]);
        g.setMode(2);
        flush();
        expect(screens).toEqual(["m0", "errored:boom", "m2"]);
      }
    );

    // Today: `["fallback"]`.
    it.fails("an untracked read inside the pass is the pass's read too", () => {
      const screens: string[] = [];
      createRoot(() => {
        const bad = createMemo((): string => {
          throw new Error("boom");
        });
        const out = createErrorBoundary(
          () => {
            // A component-body-shaped catch: untracked, inside the render pass.
            let v = "fallback";
            try {
              v = untrack(bad);
            } catch {}
            return v;
          },
          e => `errored:${(e() as Error).message}`
        );
        createRenderEffect(out, v => void screens.push(v));
      });
      flush();
      expect(screens).toEqual(["errored:boom"]);
    });

    // Today: nothing is reported at the mount.
    it.fails(
      "the error reported names the memo that threw (StatusError source), not the catching reader",
      () => {
        let reported: unknown;
        createRoot(() => {
          const g = graph();
          const out = createErrorBoundary(
            () => g.catching(),
            e => {
              reported = e();
              return "errored";
            }
          );
          createRenderEffect(out, () => {});
        });
        flush();
        expect((reported as Error).message).toBe("boom");
      }
    );

    // Today: `["caught!"]` — the flight lands the caught value.
    it.fails(
      "flight: an async body that catches an errored read is errored with it; its promise is not the answer",
      async () => {
        const screens: string[] = [];
        let g!: ReturnType<typeof graph>;
        let asyncCatching!: () => string;
        createRoot(() => {
          g = graph();
          asyncCatching = createMemo(async () => {
            let v: string;
            try {
              v = g.bad();
            } catch {
              v = "caught";
            }
            await null;
            return v + "!";
          });
          const out = createErrorBoundary(
            () => asyncCatching(),
            e => `errored:${(e() as Error).message}`
          );
          createRenderEffect(out, v => void screens.push(v));
        });
        flush();
        await settle();
        expect(screens).toEqual(["errored:boom"]);
        g.setMode(2);
        flush();
        await settle();
        expect(screens).toEqual(["errored:boom", "m2!"]);
      }
    );

    // Today: `["caught"]`. On `fix/errored-reader-4486` this one still fails
    // for a second reason: the derive's own flight (projection.ts
    // `asyncWrite`) lands over the error because the rethrow happens after
    // `_fn` returned, past the projection wrapper's catch (~20 B more of core,
    // or a flag check inside the wrapper).
    it.fails(
      "an async projection derive that catches an errored read is errored with it; the flight does not land over the error",
      async () => {
        const screens: string[] = [];
        let g!: ReturnType<typeof graph>;
        createRoot(() => {
          g = graph();
          const p = createProjection(
            async (draft: { v: string }) => {
              let v: string;
              try {
                v = g.bad();
              } catch {
                v = "caught";
              }
              await null;
              draft.v = v;
            },
            { v: "" }
          );
          const out = createErrorBoundary(
            () => p.v,
            e => `errored:${(e() as Error).message}`
          );
          createRenderEffect(out, v => void screens.push(v));
        });
        flush();
        await settle();
        expect(screens).toEqual(["errored:boom"]);
        g.setMode(2);
        flush();
        await settle();
        expect(screens).toEqual(["errored:boom", "m2"]);
      }
    );

    // Today: `["caught"]`.
    it.fails("a sync projection derive that catches an errored read is errored with it", () => {
      const screens: string[] = [];
      createRoot(() => {
        const g = graph();
        const p = createProjection(
          (draft: { v: string }) => {
            try {
              draft.v = g.bad();
            } catch {
              draft.v = "caught";
            }
          },
          { v: "" }
        );
        const out = createErrorBoundary(
          () => p.v,
          e => `errored:${(e() as Error).message}`
        );
        createRenderEffect(out, v => void screens.push(v));
      });
      flush();
      expect(screens).toEqual(["errored:boom"]);
    });
  });

  describe("what holds today and under the ruling", () => {
    it("by the second re-run the boundary shows the error — where the ruling has it from the mount", () => {
      const { g, screens } = mountUnderBoundary();
      g.setOther(1);
      flush();
      g.setOther(2);
      flush();
      expect(screens.at(-1)).toBe("errored:boom");
      // (Today the memo itself still reads "caught" here; the ruled `throw`
      // is pinned above.)
    });

    it("recovery: when the source stops throwing, the reader re-derives and shows its value (D-39)", () => {
      const { g, screens } = mountUnderBoundary();
      g.setMode(2);
      flush();
      expect(screens.at(-1)).toBe("m2");
      expect(g.catching()).toBe("m2");
      expect(g.runs).toEqual(["run", "caught:boom", "run"]);
    });

    it("a source that errors under a reader with a value marks the reader by propagation; it is not run (D-42)", () => {
      const { g, screens } = mountUnderBoundary(0);
      expect(screens).toEqual(["m0"]);
      g.setMode(1);
      flush();
      expect(screens).toEqual(["m0", "errored:boom"]);
      expect(g.runs).toEqual(["run"]);
      expect(() => g.catching()).toThrow("boom");
    });

    describe("the runtime's own catchers are not readers that catch", () => {
      it("isPending(() => bad()) is false and does not error the pass", () => {
        const screens: string[] = [];
        createRoot(() => {
          const bad = createMemo((): string => {
            throw new Error("boom");
          });
          const probe = createMemo(() => `pending:${isPending(() => bad())}`);
          createRenderEffect(probe, v => void screens.push(v));
        });
        flush();
        expect(screens).toEqual(["pending:false"]);
      });

      it("latest(() => bad()) throws the error: the pass errors as it always did", () => {
        const screens: string[] = [];
        createRoot(() => {
          const bad = createMemo((): string => {
            throw new Error("boom");
          });
          const shown = createMemo(() => latest(() => bad()));
          const out = createErrorBoundary(
            () => shown(),
            e => `errored:${(e() as Error).message}`
          );
          createRenderEffect(out, v => void screens.push(v));
        });
        flush();
        expect(screens).toEqual(["errored:boom"]);
      });

      it("a boundary's output catches its content's error and is not errored itself", () => {
        const screens: string[] = [];
        createRoot(() => {
          const bad = createMemo((): string => {
            throw new Error("boom");
          });
          const inner = createErrorBoundary(
            () => bad(),
            e => `inner:${(e() as Error).message}`
          );
          const outer = createErrorBoundary(
            () => inner(),
            e => `outer:${(e() as Error).message}`
          );
          createRenderEffect(outer, v => void screens.push(v));
        });
        flush();
        expect(screens).toEqual(["inner:boom"]);
      });
    });
  });
});
