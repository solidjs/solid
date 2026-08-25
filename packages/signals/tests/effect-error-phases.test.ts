/**
 * Pins the error-handling contract of createEffect's two phases (#2839, #2840).
 *
 * Compute phase — reactivity errors (the compute function or upstream sources):
 *   - no `error` handler: logged, the run is skipped, the app keeps going.
 *     A non-render effect's reactivity failing does not crash the system.
 *   - with an EffectBundle `error` handler: the handler receives the error
 *     the user threw (never the internal StatusError wrapper).
 *   - rethrowing from the handler escalates: nearest error boundary, else halt.
 *
 * Effect phase — the user's own imperative code:
 *   - NOT routed to the bundle's `error` handler; handle with try/catch.
 *   - uncaught: nearest error boundary, else the system halts loudly.
 *
 * The `error` handler is the error arm of the effect phase (#2840 ruling):
 *   - it runs queued in the same imperative, writable scope as `effect` —
 *     signal writes are legal, no REACTIVE_WRITE_IN_OWNED_SCOPE.
 *   - it observes settled outcomes: an error that recovers before the effect
 *     phase never reaches the handler (the success arm runs instead), and a
 *     held transition defers the handler exactly as it defers `effect`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  action,
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

describe("createEffect error phases (#2839)", () => {
  let errorSpy!: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("compute-phase throw with no handler: logged, run skipped, system alive", () => {
    const log: string[] = [];
    const [beat, setBeat] = createSignal(0);
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      createRenderEffect(beat, v => {
        log.push(`beat=${v}`);
      });
      createEffect(
        () => {
          if (armed()) throw new Error("boom-compute");
          return 0;
        },
        () => {
          log.push("effect ran");
        }
      );
    });
    flush();
    expect(log).toEqual(["beat=0", "effect ran"]);
    log.length = 0;

    expect(() => {
      setArmed(true);
      flush();
    }).not.toThrow();
    // Logged, effect skipped its run, nothing halted
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "boom-compute" }));
    expect(log).toEqual([]);

    setBeat(1);
    flush();
    expect(log).toEqual(["beat=1"]);
  });

  it("compute-phase throw with EffectBundle handler: handler receives it, no log", () => {
    const log: string[] = [];
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw new Error("boom-compute");
          return 0;
        },
        {
          effect: () => {},
          error: err => {
            log.push(`handler: ${(err as Error).message}`);
          }
        }
      );
    });
    flush();

    setArmed(true);
    flush();
    expect(log).toEqual(["handler: boom-compute"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("handler receives the thrown error's identity, not the internal wrapper (#2840)", () => {
    class MyError extends Error {}
    const boom = new MyError("boom-identity");
    const [armed, setArmed] = createSignal(false);
    let received: unknown;

    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw boom;
          return 0;
        },
        {
          effect: () => {},
          error: err => {
            received = err;
          }
        }
      );
    });
    flush();

    setArmed(true);
    flush();
    // The exact object the user threw — instanceof works, no StatusError
    // wrapper, no internal `.source`, matching createErrorBoundary's fallback.
    expect(received).toBe(boom);
    expect(received).toBeInstanceOf(MyError);
    expect(received && typeof received === "object" && "source" in received).toBe(false);
  });

  it("unhandled compute-phase error is logged unwrapped (#2840)", () => {
    class MyError extends Error {}
    const boom = new MyError("boom-log");
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw boom;
          return 0;
        },
        () => {}
      );
    });
    flush();

    setArmed(true);
    flush();
    expect(errorSpy).toHaveBeenCalledWith(boom);
  });

  it("handler runs in a writable scope: signal writes are legal (#2840)", () => {
    const [armed, setArmed] = createSignal(false);
    const [errorMsg, setErrorMsg] = createSignal("");
    const views: string[] = [];

    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw new Error("boom-write");
          return 0;
        },
        {
          effect: () => {},
          // The natural "set error state" pattern — must not trip
          // REACTIVE_WRITE_IN_OWNED_SCOPE now that the handler runs in the
          // same imperative scope as the effect arm.
          error: err => {
            setErrorMsg((err as Error).message);
          }
        }
      );
      createRenderEffect(errorMsg, v => {
        views.push(v);
      });
    });
    flush();
    expect(views).toEqual([""]);

    setArmed(true);
    flush();
    expect(errorMsg()).toBe("boom-write");
    expect(views).toEqual(["", "boom-write"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("error that recovers before the effect phase never reaches the handler (#2840)", () => {
    // The handler observes settled outcomes, like the effect arm. An error
    // raised and corrected within the same flush window is not a settled
    // state — the success arm runs with the recovered value instead.
    const [source, setSource] = createSignal(0);
    const handled: string[] = [];
    const ran: number[] = [];

    createRoot(() => {
      createEffect(
        () => {
          const v = source();
          if (v === 1) throw new Error("transient");
          return v;
        },
        {
          effect: v => {
            ran.push(v);
          },
          error: err => {
            handled.push((err as Error).message);
          }
        }
      );
    });
    flush();
    expect(ran).toEqual([0]);

    setSource(1); // errors...
    setSource(2); // ...but recovers before any flush
    flush();
    expect(handled).toEqual([]); // handler never saw the transient error
    expect(ran).toEqual([0, 2]); // success arm observed the settled value

    setSource(1); // now let it settle in error
    flush();
    expect(handled).toEqual(["transient"]);
    expect(ran).toEqual([0, 2]);
  });

  it("a held transition defers the handler like it defers the effect arm (#2840)", async () => {
    // An action holds its transition until the yielded promise settles. A
    // compute error raised while held must not fire the handler mid-hold —
    // it fires when the transition completes, same schedule as `effect`.
    const [armed, setArmed] = createSignal(false);
    const handled: string[] = [];
    let releaseAction!: () => void;

    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw new Error("boom-held");
          return 0;
        },
        {
          effect: () => {},
          error: err => {
            handled.push((err as Error).message);
          }
        }
      );
    });
    flush();

    const held = action(function* () {
      setArmed(true);
      yield new Promise<void>(r => (releaseAction = r));
    })();
    flush();
    // Transition is holding: the compute errored speculatively, but the
    // error arm must not have fired yet.
    expect(handled).toEqual([]);

    releaseAction();
    await held;
    flush();
    expect(handled).toEqual(["boom-held"]);
  });

  it("async source rejection reaches the handler unwrapped (#2840)", async () => {
    class MyError extends Error {}
    const boom = new MyError("boom-async");
    const [armed, setArmed] = createSignal(false);
    let received: unknown;
    let reject!: (e: unknown) => void;

    createRoot(() => {
      const data = createMemo(async () => {
        if (!armed()) return "ok";
        await new Promise((_, rej) => (reject = rej));
      });
      createEffect(() => data(), {
        effect: () => {},
        error: err => {
          received = err;
        }
      });
    });
    flush();
    await Promise.resolve();
    flush();

    setArmed(true);
    flush();
    reject(boom);
    await new Promise(r => setTimeout(r, 0));
    flush();
    expect(received).toBe(boom);
  });

  it("handler rethrow escalates to the nearest error boundary", () => {
    const log: string[] = [];
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      const boundary = createErrorBoundary(
        () => {
          createEffect(
            () => {
              if (armed()) throw new Error("boom-compute");
              return 0;
            },
            {
              effect: () => {},
              error: err => {
                log.push("handler saw it");
                throw err;
              }
            }
          );
          return "content";
        },
        err => `fallback:${(err as () => Error)().message}`
      );
      createRenderEffect(boundary, v => {
        log.push(String(v));
      });
    });
    flush();
    expect(log).toEqual(["content"]);
    log.length = 0;

    setArmed(true);
    flush();
    expect(log).toEqual(["handler saw it", "fallback:boom-compute"]);
  });

  it("effect-phase throw is NOT routed to the bundle handler; boundary catches it", () => {
    const log: string[] = [];
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      const boundary = createErrorBoundary(
        () => {
          createEffect(armed, {
            effect: on => {
              if (on) throw new Error("boom-effect");
            },
            error: err => {
              log.push(`handler: ${(err as Error).message}`);
            }
          });
          return "content";
        },
        err => `fallback:${(err as () => Error)().message}`
      );
      createRenderEffect(boundary, v => {
        log.push(String(v));
      });
    });
    flush();
    expect(log).toEqual(["content"]);
    log.length = 0;

    setArmed(true);
    flush();
    // The per-effect handler is for compute-phase (reactivity) errors only;
    // the effect body is the user's own imperative code.
    expect(log).toEqual(["fallback:boom-effect"]);
  });

  it("effect-phase throw with no boundary halts the system loudly", () => {
    const log: string[] = [];
    const [beat, setBeat] = createSignal(0);
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      createRenderEffect(beat, v => {
        log.push(`beat=${v}`);
      });
      createEffect(armed, {
        effect: on => {
          if (on) throw new Error("boom-effect");
        },
        error: () => {
          log.push("handler must not fire");
        }
      });
    });
    flush();
    log.length = 0;

    expect(() => {
      setArmed(true);
      flush();
    }).toThrow("boom-effect");
    expect(log).toEqual([]);
    // The halt log carries the causing error alongside the message (#2884).
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("REACTIVITY_HALTED"),
      expect.objectContaining({ message: "boom-effect" })
    );

    setBeat(1);
    flush();
    expect(log).toEqual([]);
  });
});
