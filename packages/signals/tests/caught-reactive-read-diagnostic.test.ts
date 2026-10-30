import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  NotReadyError,
  OBSERVE,
  resolve,
  untrack,
  type DiagnosticEvent
} from "../src/index.js";

// D-42 / S-47: a reactive read's throw is addressed to the graph, not to the
// code around the read; `try/catch` around it is not a channel. The dev
// diagnostic CAUGHT_REACTIVE_READ reports the detectable half — a pass whose
// body RETURNED after a read threw into it (the catch ran and swallowed). The
// bypass (a dependent marked, not run) has nothing to detect and is pinned
// as it is in `try-catch-reactive-read.test.ts`.

let resolvers: ((v: any) => void)[] = [];
function pending<T>(): Promise<T> {
  return new Promise<T>(r => resolvers.push(r));
}
async function settle() {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
  }
}

let stopCapture: (() => DiagnosticEvent[]) | null = null;
function captureWarnings() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const capture = OBSERVE!.diagnostics.capture();
  return (stopCapture = () => {
    stopCapture = null;
    const events = capture.stop().filter(e => e.code === "CAUGHT_REACTIVE_READ");
    warn.mockRestore();
    error.mockRestore();
    return events;
  });
}
afterEach(() => {
  stopCapture?.();
  flush();
  resolvers = [];
});

describe("CAUGHT_REACTIVE_READ (dev): a caught reactive read that completed", () => {
  it("(a) a memo catching the NotReady of an async memo on its first pass warns once, naming both", async () => {
    const stop = captureWarnings();
    let dispose!: () => void;
    const screens: string[] = [];
    createRoot(d => {
      dispose = d;
      const data = createMemo(
        async () => {
          await pending<void>();
          return "d";
        },

        { name: "data" }
      );
      const guarded = createMemo(
        () => {
          try {
            return data();
          } catch {
            return "caught";
          }
        },

        { name: "guarded" }
      );
      createRenderEffect(guarded, v => void screens.push(v));
    });
    flush();
    expect(screens).toEqual(["caught"]);
    const events = stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code: "CAUGHT_REACTIVE_READ",
      kind: "async",
      severity: "warn",
      ownerName: "guarded",
      nodeName: "data"
    });
    expect(events[0].message).toContain('"guarded" caught the not-ready throw of "data"');
    expect(events[0].message).toContain("isPending()");
    resolvers.shift()!(undefined);
    await settle();
    expect(screens).toEqual(["caught", "d"]);
    dispose();
  });

  it("(b) a memo catching a sync memo's error warns once, with the error wording", () => {
    const stop = captureWarnings();
    let dispose!: () => void;
    let value = "";
    createRoot(d => {
      dispose = d;
      const [mode] = createSignal(1);
      const source = createMemo(
        () => {
          if (mode() === 1) throw new Error("boom");
          return `m${mode()}`;
        },

        { name: "source" }
      );
      const guarded = createMemo(
        () => {
          try {
            return source();
          } catch {
            return "caught";
          }
        },

        { name: "guarded" }
      );
      createRenderEffect(guarded, v => void (value = v));
    });
    flush();
    expect(value).toBe("caught");
    const events = stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ownerName: "guarded", nodeName: "source" });
    expect(events[0].message).toContain('"guarded" caught the error of "source"');
    expect(events[0].message).toContain("<Errored>");
    dispose();
  });

  it("(c) the rethrow idiom does not warn: the pass did not complete", async () => {
    const stop = captureWarnings();
    let dispose!: () => void;
    const screens: string[] = [];
    createRoot(d => {
      dispose = d;
      const data = createMemo(async () => {
        await pending<void>();
        return "d";
      });
      const guarded = createMemo(() => {
        try {
          return data();
        } catch (e) {
          if (e instanceof NotReadyError) throw e;
          return "caught";
        }
      });
      createRenderEffect(guarded, v => void screens.push(v));
    });
    flush();
    expect(screens).toEqual([]);
    resolvers.shift()!(undefined);
    await settle();
    expect(screens).toEqual(["d"]);
    expect(stop()).toEqual([]);
    dispose();
  });

  it("(d) once per computation: a re-run that catches again does not warn twice", async () => {
    const stop = captureWarnings();
    let dispose!: () => void;
    let setOther!: (v: number) => void;
    const runs: string[] = [];
    createRoot(d => {
      dispose = d;
      const [other, _setOther] = createSignal(0);
      setOther = _setOther;
      const data = createMemo(async () => {
        await pending<void>();
        return "d";
      });
      const guarded = createMemo(() => {
        const o = other();
        try {
          return `${data()}:${o}`;
        } catch {
          runs.push(`caught:${o}`);
          return `caught:${o}`;
        }
      });
      createRenderEffect(guarded, () => {});
    });
    flush();
    // Another input of its own re-runs it while the source is still loading:
    // the catch fires again (S-47: a pass that happens to run while the
    // source is in that state) — same computation, no second report.
    setOther(1);
    flush();
    setOther(2);
    flush();
    expect(runs).toEqual(["caught:0", "caught:1", "caught:2"]);
    expect(stop()).toHaveLength(1);
    resolvers.shift()!(undefined);
    await settle();
    dispose();
  });

  describe("(e) the runtime's own catches do not warn", () => {
    it("isPending(() => uninitialized()) unowned, and owned with another source found pending", async () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      let data!: () => string;
      let setK!: (v: number) => void;
      let setGate!: (v: boolean) => void;
      const probes: boolean[] = [];
      createRoot(d => {
        dispose = d;
        const [k, _setK] = createSignal(0);
        const [gate, _setGate] = createSignal(false);
        setK = _setK;
        setGate = _setGate;
        const a = createMemo(async () => {
          const v = k();
          await pending<void>();
          return `a${v}`;
        });
        data = createMemo(async () => {
          await pending<void>();
          return "d";
        });
        // Owned: a probe that finds `a` pending (initialized, re-asked) and
        // then meets `data` still loading swallows the NotReady — the
        // runtime's catch (A16/B5a) — and the pass completes with `true`.
        createRenderEffect(
          () => isPending(() => (a(), gate() && data())),
          v => void probes.push(v)
        );
      });
      flush();
      resolvers.shift()!(undefined); // a0 lands
      await settle();
      expect(probes).toEqual([false]);
      // Unowned: swallowed outright (B5a) — `data` is loading, not pending.
      expect(isPending(() => data())).toBe(false);
      setK(1);
      setGate(true);
      flush();
      await settle();
      expect(probes.at(-1)).toBe(true);
      expect(stop()).toEqual([]);
      dispose();
    });

    it("a <Loading> boundary catching its content, and its `on` re-arm reading a pending source", async () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      let result: any;
      let setTrigger!: (v: number) => void;
      createRoot(d => {
        dispose = d;
        const [trigger, _setTrigger] = createSignal(0);
        setTrigger = _setTrigger;
        const model = createMemo(async () => {
          const t = trigger();
          await Promise.resolve();
          return { id: t, label: `item-${t}` };
        });
        const boundary = createLoadingBoundary(
          () => model().label,
          () => "loading",
          { on: () => model().id }
        );
        createRenderEffect(
          () => (result = boundary()),
          () => {}
        );
      });
      flush();
      expect(result).toBe("loading");
      await settle();
      expect(result).toBe("item-0");
      setTrigger(1);
      flush();
      expect(result).toBe("loading");
      await settle();
      expect(result).toBe("item-1");
      expect(stop()).toEqual([]);
      dispose();
    });

    it("an <Errored> boundary catching its content", () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      let result: any;
      createRoot(d => {
        dispose = d;
        const source = createMemo((): string => {
          throw new Error("boom");
        });
        const b = createErrorBoundary(
          () => source(),
          e => `errored:${(e() as Error).message}`
        );
        createRenderEffect(
          () => (result = b()),
          () => {}
        );
      });
      flush();
      expect(result).toBe("errored:boom");
      expect(stop()).toEqual([]);
      dispose();
    });

    it("resolve() over an erroring memo (watch's error arm)", async () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      let p!: Promise<string>;
      createRoot(d => {
        dispose = d;
        const source = createMemo((): string => {
          throw new Error("boom");
        });
        p = resolve(() => source());
      });
      await expect(p).rejects.toThrow("boom");
      expect(stop()).toEqual([]);
      dispose();
    });
  });

  it("(f) a component-body-shaped catch — untrack inside a render effect — warns and is attributed to that effect", async () => {
    const stop = captureWarnings();
    let dispose!: () => void;
    let shown = "";
    createRoot(d => {
      dispose = d;
      const data = createMemo(
        async () => {
          await pending<void>();
          return "d";
        },

        { name: "data" }
      );
      createRenderEffect(
        () => {
          let v = "none";
          untrack(() => {
            try {
              v = data();
            } catch {
              v = "caught";
            }
          });
          return v;
        },
        v => void (shown = v),
        { name: "body" }
      );
    });
    flush();
    expect(shown).toBe("caught");
    const events = stop();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ownerName: "body", nodeName: "data" });
    resolvers.shift()!(undefined);
    await settle();
    dispose();
  });

  it("a computation that never read the source is indistinguishable — and does not warn", () => {
    const stop = captureWarnings();
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const [n] = createSignal(1);
      const plain = createMemo(() => {
        try {
          return n() * 2;
        } catch {
          return 0;
        }
      });
      createRenderEffect(plain, () => {});
    });
    flush();
    expect(stop()).toEqual([]);
    dispose();
  });

  describe("(g) a body that became a flight is judged at the flight's settle", () => {
    it("an async memo reading a pending source before its first await does not warn: the rejection is the throw continuing", async () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      const screens: string[] = [];
      createRoot(d => {
        dispose = d;
        const a = createMemo(
          async () => {
            await pending<void>();
            return "a";
          },
          { name: "a" }
        );
        const b = createMemo(
          async () => {
            const x = a();
            await null;
            return x + "b";
          },
          { name: "b" }
        );
        createRenderEffect(b, v => void screens.push(v));
      });
      flush();
      await settle();
      expect(screens).toEqual([]);
      resolvers.shift()!(undefined);
      await settle();
      expect(screens).toEqual(["ab"]);
      expect(stop()).toEqual([]);
      dispose();
    });

    it("an async memo catching before its first await and resolving warns when the value lands", async () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      const screens: string[] = [];
      createRoot(d => {
        dispose = d;
        const a = createMemo(
          async () => {
            await pending<void>();
            return "a";
          },
          { name: "a" }
        );
        const b = createMemo(
          async () => {
            let x: string;
            try {
              x = a();
            } catch {
              x = "caught";
            }
            await null;
            return x + "b";
          },
          { name: "b" }
        );
        createRenderEffect(b, v => void screens.push(v));
      });
      flush();
      expect(stop()).toEqual([]);
      const stop2 = captureWarnings();
      await settle();
      expect(screens).toEqual(["caughtb"]);
      const events = stop2();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ ownerName: "b", nodeName: "a" });
      resolvers.shift()!(undefined);
      await settle();
      expect(screens).toEqual(["caughtb", "ab"]);
      dispose();
    });

    it("an async memo rethrowing a wrapped error does not warn: a rejection is not a completed pass", async () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      let caught: unknown;
      createRoot(d => {
        dispose = d;
        const [n] = createSignal(1);
        const bad = createMemo(() => {
          if (n() === 1) throw new Error("boom");
          return n;
        });
        const b = createMemo(async () => {
          try {
            return bad();
          } catch (e) {
            throw new Error("wrapped", { cause: e });
          }
        });
        const out = createErrorBoundary(
          () => {
            b();
          },
          e => void (caught = e())
        );
        createRenderEffect(out, () => {});
      });
      flush();
      await settle();
      expect((caught as Error)?.message).toBe("wrapped");
      expect(stop()).toEqual([]);
      dispose();
    });

    it("an async projection (self-registered flight) reading a pending source before its first await does not warn", async () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      const screens: number[] = [];
      createRoot(d => {
        dispose = d;
        const a = createMemo(
          async () => {
            await pending<void>();
            return 2;
          },
          { name: "a" }
        );
        const p = createProjection(
          async (draft: { v: number }) => {
            const x = a();
            await null;
            draft.v = x;
          },
          { v: 0 },
          { name: "p" }
        );
        createRenderEffect(
          () => p.v,
          v => void screens.push(v)
        );
      });
      flush();
      await settle();
      resolvers.shift()!(undefined);
      await settle();
      expect(screens).toEqual([2]);
      expect(stop()).toEqual([]);
      dispose();
    });

    it("an async projection catching before its first await warns when its flight lands", async () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      const screens: number[] = [];
      createRoot(d => {
        dispose = d;
        const a = createMemo(
          async () => {
            await pending<void>();
            return 2;
          },
          { name: "a" }
        );
        const p = createProjection(
          async (draft: { v: number }) => {
            let x: number;
            try {
              x = a();
            } catch {
              x = -1;
            }
            await null;
            draft.v = x;
          },
          { v: 0 },
          { name: "p" }
        );
        createRenderEffect(
          () => p.v,
          v => void screens.push(v)
        );
      });
      flush();
      await settle();
      expect(screens).toEqual([-1]);
      const events = stop();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ ownerName: "p", nodeName: "a" });
      dispose();
    });

    it("a sync projection derive catching a pending read warns", async () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const a = createMemo(
          async () => {
            await pending<void>();
            return 2;
          },
          { name: "a" }
        );
        const p = createProjection(
          (draft: { v: number }) => {
            try {
              draft.v = a();
            } catch {
              draft.v = -1;
            }
          },
          { v: 0 },
          { name: "p" }
        );
        createRenderEffect(
          () => p.v,
          () => {}
        );
      });
      flush();
      const events = stop();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ ownerName: "p", nodeName: "a" });
      dispose();
    });

    it("a sync body returning a plain object is judged immediately", () => {
      const stop = captureWarnings();
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const bad = createMemo(() => {
          throw new Error("boom");
        });
        const obj = createMemo(() => {
          try {
            return { v: bad() };
          } catch {
            return { v: 0 };
          }
        });
        createRenderEffect(obj, () => {});
      });
      flush();
      expect(stop()).toHaveLength(1);
      dispose();
    });
  });
});
