/**
 * Candidate L2 bugs surfaced by GabbeV's semantic fuzzer (#3446) re-run
 * against the hold model (#3774, `next` @ 203ab1a43), 2026-10-05.
 *
 * Each `it.fails` pin states what the spec says and fails on the engine's
 * current behaviour; the rule it cites is the one the fuzzer's oracle holds
 * it to, re-derived against `docs/SPEC-ASYNC-SEMANTICS.md`'s L2 section. The
 * shapes are the fuzzer's reductions translated to primitives and verified
 * standalone (no harness, no attribution hooks). Nothing here changes the
 * engine; a fix flips the pin to `it`.
 *
 * Fuzzer provenance (seed 3289, 2000 cases per cohort; `tests/semantics`,
 * rule names are the fuzzer's: S1 coherence, S2 control/reader agreement,
 * P1 progress, L1 final view, click = the guarded-read law):
 *   F1  boundaries.test.ts nested shape     F7  latest    cases 201, 625, 810 (error)
 *   F2  ordinary       case 80   (S2)       F8  latest    case 658 (S2 mount control)
 *   F3  observation    case 1073 (P1)       F9  readiness cases 8, 1130 (L1)
 *   F4  nested         case 112  (S1 tear)  F10 readiness cases 1320, 594 (L1, click)
 *   F5  optimistic     case 1590 (S1 tear)  F11 readiness cases 1366, 10 (L1, S1)
 *   F6  latest         cases 330, 1216 (S1) F12 derived-readiness case 1793 (error)
 *   F13 latest         cases 788, 930 (L1; the 2026-10-05 1000-case re-run)
 */
import { describe, expect, it, afterEach } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  onCleanup,
  resetErrorHalt
} from "../src/index.js";

const tick = () => new Promise<void>(r => setTimeout(r, 0));
async function drain(n = 3) {
  for (let i = 0; i < n; i++) {
    await tick();
    flush();
  }
}
/** A manual flight per captured input, so each landing is chosen by the test. */
function gated<T>(gates: Map<string, () => void>, key: string, value: T): Promise<T> {
  return new Promise<T>(r => {
    gates.set(key, () => r(value));
  });
}
/** Collect the errors a flush throws from a microtask (a halt, a livelock
 * guard) so the pin can assert on them instead of the run aborting. */
function captureErrors(): { errors: unknown[]; stop(): void } {
  const errors: unknown[] = [];
  const onErr = (e: any) => {
    errors.push(e?.reason ?? e);
  };
  process.on("uncaughtException", onErr);
  process.on("unhandledRejection", onErr);
  return {
    errors,
    stop() {
      process.off("uncaughtException", onErr);
      process.off("unhandledRejection", onErr);
    }
  };
}

afterEach(() => {
  // A crash pin halts the system (REACTIVITY_HALTED); the next pin needs it back.
  resetErrorHalt();
});

describe("fuzz findings on L2 — holds and boundaries", () => {
  // F1. boundaries.ts' status protocol (B5): "the nearest boundary of that
  // status that is collecting — … a loading boundary … whose `on` just
  // changed — records the reader and shows its fallback, and the root never
  // hears of it"; A33: a Loading reset moves the hold onto THE boundary. Two
  // nested boundaries re-armed by one tick: the inner is the nearest
  // collecting boundary for the binding under it, so the outer's content —
  // whose own flight has landed — should show beside the inner's fallback
  // (`createLoadingBoundary.test.ts` "nested boundaries - inner catches
  // async" is the mount-time form). On L2 the outer records the inner's
  // reader too (catchStatus walks every boundary while none is armed yet) and
  // keeps its fallback until the inner's flight lands.
  it.fails(
    "F1: an outer on-reset boundary does not wait for a flight its nested on-reset boundary catches (A33, B5)",
    async () => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const gates = new Map<string, () => void>();
      let outer: unknown, inner: unknown;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const ma = createMemo(() => gated(gates, `a:${a()}`, a()));
        const mb = createMemo(() => gated(gates, `b:${b()}`, b()));
        const outerView = createLoadingBoundary(
          () => {
            createRenderEffect(ma, () => {}); // a binding inside the outer content
            const innerView = createLoadingBoundary(
              () => {
                createRenderEffect(mb, () => {}); // a binding inside the inner content
                return "inner-content";
              },
              () => "inner-loading",
              { on: a }
            );
            createRenderEffect(innerView, v => {
              inner = v;
            });
            return "outer-content";
          },
          () => "outer-loading",
          { on: a }
        );
        createRenderEffect(outerView, v => {
          outer = v;
        });
      });
      flush();
      gates.get("a:0")!();
      gates.get("b:0")!();
      await drain();
      expect([outer, inner]).toEqual(["outer-content", "inner-content"]);
      setA(1);
      setB(1); // both boundaries re-arm on `a`; both flights are up
      await drain();
      expect(outer).toBe("outer-loading");
      gates.get("a:1")!();
      await drain();
      // The outer's own work landed; the inner's flight is the inner's fallback.
      expect([outer, inner]).toEqual(["outer-content", "inner-loading"]);
      dispose();
      gates.get("b:1")!();
      await drain();
    }
  );

  // F2. A15 reveal corollary: "a write that makes a render reader read a
  // pending node for the first time … the reveal holds and joins the
  // transition the flight blocks … whenever the flight's inputs are already
  // visible"; #3494: when a reveal and a release meet, "the reveal wins". The
  // reveal here is a landing: `show=true` was held by flight(1) through the
  // panel's observation; `src=0` supersedes that flight and the panel's
  // mainline pass (served the committed `show`) stops reading it, so the hold
  // lands — and its stale-reader re-derivation then discovers flight(0) with
  // `src=0` visible. The landing published `show=true` beside a panel that can
  // only say "hidden": a torn frame the reveal corollary forbids.
  it.fails(
    "F2: a landing does not reveal a gate its stale reader re-derives onto a new flight (A15 reveal corollary)",
    async () => {
      const [show, setShow] = createSignal(true);
      const [src, setSrc] = createSignal(0);
      const gates = new Map<string, () => void>();
      let shown: unknown, panel: unknown;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const m0 = createMemo(() => gated(gates, `m0:${src()}`, src()));
        const m1 = createMemo(() => m0());
        createRenderEffect(
          () => (show() ? [src(), m1()] : "hidden"),
          v => {
            panel = JSON.stringify(v);
          }
        );
        createRenderEffect(show, v => {
          shown = v;
        });
      });
      flush();
      gates.get("m0:0")!();
      await drain();
      expect([shown, panel]).toEqual([true, "[0,0]"]);
      setShow(false);
      setSrc(1); // hide, and start flight(1) that nothing observes → commits
      await drain();
      expect([shown, panel]).toEqual([false, '"hidden"']);
      setShow(true); // the reveal discovers flight(1) (inputs visible): held
      await drain();
      expect([shown, panel]).toEqual([false, '"hidden"']);
      setSrc(0); // flight(0) supersedes flight(1); the hold on `show` lands
      await drain();
      // Either both are revealed together (flight(0) landed) or neither is.
      expect(shown === true ? panel : '"hidden"').toBe(shown === true ? "[0,0]" : '"hidden"');
      dispose();
      gates.get("m0:0")?.();
      await drain();
    }
  );

  // F3. L2 ruling A (A29): "a held pass's children compute but do not effect
  // and die with the commit that replaces their frame"; A15 #3463: a zombie
  // is "live for every hold until the commit that disposes it". A reader
  // mounted while a flight is up is born held (its mount control stays
  // unpublished); unmounting it in the same hold stages its removal; that
  // hold lands (mount nets to committed) and its commits dispose the zombie.
  // The seam judged the newer transaction (`src=0`, held only because the
  // zombie observes its flight) first, blocked, and never again: a
  // `schedule()` from the disposal inside the landing is overwritten by the
  // flush's own `scheduled` recompute. The seam now re-judges the parked
  // transactions after every landing (fuzzer P1).
  it("F3: a write held only by a zombie lands with the commit that disposes it (A29 ruling A, A15 #3463)", async () => {
    const gates = new Map<string, () => void>();
    const [src, setSrc] = createSignal(0);
    const [mounted, setMounted] = createSignal(false);
    let shownSrc = -1,
      shownMounted: boolean | undefined,
      panel: unknown = "absent";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const a = createMemo(() => gated(gates, `a:${src()}`, src()));
      const b = createMemo(() => {
        const v = a();
        return gated(gates, `b:${v}`, v);
      });
      createRenderEffect(src, v => {
        shownSrc = v;
      });
      createRenderEffect(mounted, v => {
        shownMounted = v;
      });
      createRenderEffect(
        () =>
          mounted()
            ? createRoot(d2 => {
                createRenderEffect(b, v => {
                  panel = v;
                });
                onCleanup(() => {
                  panel = "absent";
                });
                return d2;
              })
            : undefined,
        d2 => {
          if (d2) onCleanup(d2);
        }
      );
    });
    flush();
    gates.get("a:0")!();
    await drain();
    gates.get("b:0")!();
    await drain();
    expect([shownSrc, shownMounted, panel]).toEqual([0, false, "absent"]);
    setSrc(1); // a:1 flies unobserved → commits
    await drain();
    expect(shownSrc).toBe(1);
    gates.get("a:1")!(); // b:1 starts, unobserved
    await drain();
    setMounted(true); // the reader is born held on b:1; the mount is held with it
    await drain();
    expect([shownMounted, panel]).toEqual([false, "absent"]);
    setSrc(0); // a:0 — held while the (unshown) reader waits
    await drain();
    expect(shownSrc).toBe(1);
    setMounted(false); // the mount request is withdrawn: nets to committed, lands
    await drain();
    expect([shownMounted, panel]).toEqual([false, "absent"]);
    // Nothing visible observes any flight: the write publishes.
    expect(shownSrc).toBe(0);
    dispose();
    for (const g of gates.values()) g();
    await drain();
  });

  // F4. A15: "writes whose async work is observed by a shared reader settle
  // as one unit (no tearing — nothing commits until all entangled async
  // resolves)"; A30: "an errored pass (a throw, NotReady included) keeps its
  // full list". The tuple reader observed m0's flight for `a=1`; a later
  // `b=1` re-runs it and the pass throws NotReady at `m1` before reaching
  // `m0`. `blockedBy` read only the pass's reads up to `_depsTail` (the O3
  // "stopped reading" rule), so the unreached `m0` counted as dropped, the
  // hold on `a=1` landed, and `A=1` showed beside a tuple still derived
  // from `a=0` while m0's flight was in the air. An errored pass did not
  // stop reading: its whole list now observes.
  it("F4: a NotReady-interrupted pass still observes the flights it did not reach (A15, A30)", async () => {
    const gates = new Map<string, () => void>();
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    let shownA = -1;
    let tuple: number[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const m0 = createMemo(() => gated(gates, `a:${a()}`, a()));
      const m1 = createMemo(() => Promise.resolve(b()));
      createRenderEffect(a, v => {
        shownA = v;
      });
      createRenderEffect(
        () => [b(), m1(), m0()],
        t => {
          tuple = t;
        }
      );
    });
    flush();
    gates.get("a:0")!();
    await drain();
    expect([shownA, tuple]).toEqual([0, [0, 0, 0]]);
    setA(1); // m0 flies for a=1, observed by the tuple reader → a=1 held
    await drain();
    expect([shownA, tuple]).toEqual([0, [0, 0, 0]]);
    setB(1); // the reader re-runs and throws at m1, before reading m0
    await drain(4);
    // a=1 must not show beside a tuple whose m0 still answers a=0.
    expect(shownA === 1 ? tuple[2] : 0).toBe(shownA === 1 ? 1 : 0);
    dispose();
    gates.get("a:1")?.();
    await drain();
  });
});

describe("fuzz findings on L2 — lanes", () => {
  // F5. A17: "when async derived from the optimistic value is in flight, the
  // lane holds its render effects (the rendered view keeps the committed
  // state as a unit)"; lanes stage (#3479): "the lane's readers … see the
  // optimistic frame … and neither is torn". A second guess on a lane that
  // has shown re-asks the derivation chain; the lane should hold its readers
  // on the shown frame until the new derivation lands. Instead the reader
  // publishes the new guess beside the previous guess's derivation.
  it.fails(
    "F5: a second guess on a shown lane does not tear against the first guess's derivation (A17)",
    async () => {
      const [source, setSource] = createSignal(0);
      const frames: string[] = [];
      let resume!: () => void;
      let run!: () => Promise<void>;
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const [view, setView] = createOptimistic(() => source());
        const d0 = createMemo(() => Promise.resolve(view()));
        const d1 = createMemo(() => {
          const v = d0();
          return Promise.resolve(v);
        });
        createRenderEffect(
          () => [view(), d1()],
          t => {
            frames.push(t.join(","));
          }
        );
        run = action(function* () {
          setView(1);
          yield new Promise<void>(r => {
            resume = r;
          });
          setView(2);
          yield new Promise<void>(r => {
            resume = r;
          });
          setSource(0);
        });
      });
      await drain();
      expect(frames).toEqual(["0,0"]);
      const p = run();
      await drain(6);
      expect(frames).toEqual(["0,0", "1,1"]);
      resume(); // second guess: 2
      await drain(6);
      // Every delivered frame is coherent: d1 derived from the view beside it.
      for (const f of frames) {
        const [v, d] = f.split(",");
        expect(d, `frame ${f}`).toBe(v);
      }
      resume();
      await p;
      await drain(6);
      dispose();
    }
  );

  // F6. A17 (L2): "a derivation of a guess with a flight up holds the lane
  // (`lanesBlocked`); `laneSeam` parks a blocked lane's runs". Without a
  // boundary the `latest(id)` reader and the async derivation's reader reveal
  // together when the derivation lands (`createMemo.test.ts` A10 lane pins).
  // With a retaining `Loading` between the derivation and its reader, the
  // boundary's tree is the subscriber and the blocker predicate sees no frame
  // reader: the lane is judged unblocked, `latest=1` shows beside
  // `details=0`, and when `details(1)` lands it never displays — the stale
  // frame stays until the action ends.
  it.fails(
    "F6: a retaining boundary between a lane's derivation and its reader does not unblock the lane (A17)",
    async () => {
      const [$id, setId] = createSignal(0);
      const gates = new Map<string, () => void>();
      let resume!: () => void;
      let run!: () => Promise<void>;
      let L = 0;
      let D: unknown = "?";
      const frames: string[] = [];
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const details = createMemo(() => {
          const id = latest($id);
          return gated(gates, `d:${id}`, id);
        });
        createRenderEffect(
          () => latest($id),
          v => {
            L = v;
            frames.push(`L=${L} D=${D}`);
          }
        );
        const view = createLoadingBoundary(details, () => "loading" as const);
        createRenderEffect(view, v => {
          D = v;
          frames.push(`L=${L} D=${D}`);
        });
        run = action(function* () {
          setId(1);
          yield new Promise<void>(r => {
            resume = r;
          });
          setId(2);
        });
      });
      flush();
      gates.get("d:0")!();
      await drain();
      expect([L, D]).toEqual([0, 0]);
      const p = run();
      await drain();
      // The lane is held by details' flight: no frame shows latest=1 alone.
      expect([L, D]).toEqual([0, 0]);
      gates.get("d:1")!();
      await drain();
      // The derivation landed: the lane reveals both.
      expect([L, D]).toEqual([1, 1]);
      resume();
      gates.get("d:2")?.();
      await p;
      await drain();
      dispose();
    }
  );

  // F8. A15 lanes corollary (#3460): "a render effect OFF the lane that reads
  // what the lane is revealing … shows the committed value, publishes now,
  // entangles nothing — and re-derives at the release"; ruling 1: a flush
  // parks as a whole. A mainline mount whose child reads a lane-held pending
  // derivation publishes the mount control (`mounted=true`) while the child
  // never attaches until the action ends — neither the committed value now
  // nor a held frame: a torn mount (fuzzer S2 "mount control").
  it.fails(
    "F8: a mainline mount reading a lane-held pending derivation shows with its mount control (A15 lanes corollary)",
    async () => {
      const [source, setSource] = createSignal(0);
      const [mounted, setMounted] = createSignal(false);
      const gates = new Map<string, () => void>();
      let resume!: () => void;
      let run!: () => Promise<void>;
      let shownMounted: unknown;
      let child: unknown = "absent";
      let dispose!: () => void;
      createRoot(d => {
        dispose = d;
        const derived = createMemo(() => {
          const v = latest(source);
          return gated(gates, `d:${v}`, v);
        });
        createRenderEffect(mounted, v => {
          shownMounted = v;
        });
        createRenderEffect(
          () =>
            mounted()
              ? createRoot(dd => {
                  createRenderEffect(derived, v => {
                    child = v;
                  });
                  onCleanup(() => {
                    child = "absent";
                  });
                  return dd;
                })
              : undefined,
          dd => {
            if (dd) onCleanup(dd);
          }
        );
        run = action(function* () {
          setSource(1);
          yield new Promise<void>(r => {
            resume = r;
          });
          setSource(2);
          yield new Promise<void>(r => {
            resume = r;
          });
        });
      });
      flush();
      gates.get("d:0")!();
      await drain();
      const p = run();
      await drain();
      gates.get("d:1")!(); // the lane's first derivation lands
      await drain();
      resume(); // source=2: the derivation re-asks, the lane is held again
      await drain();
      setMounted(true); // a mainline mount over the held derivation
      await drain();
      // The mount control and its child are one frame: both show, or neither.
      expect(shownMounted === true).toBe(child !== "absent");
      gates.get("d:2")!();
      resume();
      await p;
      await drain();
      dispose();
    }
  );

  // F13. A29 (creation-time form): a reader born held is "staged into [the
  // transaction], committed with it" — `recompute`'s own note: "An effect
  // still carrying an uncommitted staged value re-stages: the commit applies
  // the latest pass, not the born-held one"; A28: a write is visible at flush
  // to every channel. A `latest(source)` reader whose mount is withdrawn in
  // the action's tick (adopted, O1) and restored in the next (A34 (1)) is
  // born held with its creation value (`_pendingValue` 0); the action's
  // final write re-runs it as the verdict lane's work. The lane arm wrote an
  // effect's run into its private `_value` (1) beside the born-held staging,
  // and the lane's seam then committed the node (`commitPendingNode`),
  // applying the stale staging (0) and queuing the run with it: the
  // committed truth never showed. A lane pass of an effect still carrying a
  // staging now re-stages it, as the frame's own pass does.
  it("F13: a born-held latest() reader re-mounted during the hold shows the action's final write (A29, A28)", async () => {
    const [source, setSource] = createSignal(0);
    const [mounted, setMounted] = createSignal(true);
    let resume!: () => void;
    let run!: () => Promise<void>;
    let child: unknown = "absent";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(mounted, () => {});
      createRenderEffect(
        () =>
          mounted()
            ? createRoot(dd => {
                createRenderEffect(
                  () => latest(source),
                  v => {
                    child = v;
                  }
                );
                onCleanup(() => {
                  child = "absent";
                });
                return dd;
              })
            : undefined,
        dd => {
          if (dd) onCleanup(dd);
        }
      );
      run = action(function* () {
        yield new Promise<void>(r => {
          resume = r;
        });
        setSource(1);
      });
    });
    flush();
    expect(child).toBe(0);
    const p = run();
    setMounted(false); // the action's tick: the unmount rides with it (O1)
    await drain();
    setMounted(true); // a write to a held node: joins the hold (A34 (1))
    await drain();
    resume(); // the body ends with the truth: source = 1
    await p;
    await drain(4);
    expect(child).toBe(1);
    dispose();
  });
});

describe("fuzz findings on L2 — verdicts", () => {
  // F9. A19: "`isPending(x)` ≡ the observable value is not final … final the
  // moment [no cause] holds it"; A34 (2): a tick whose writes net to the
  // committed value "pends nothing: `isPending` stays false". `setSrc(1);
  // setSrc(0)` re-asks the async memo for the committed input; the probe
  // reader was re-derived when the memo went pending (`propagateStatus`'s
  // verdict arm) and read `true`. The re-ask landed equal to the committed
  // value: `setSignal` notified nobody, and the settle walk skipped the
  // reader — a verdict reader holds no pending source of its own — so it
  // read `true` forever. (A plain data reader beside it re-ran on its own
  // settle and took the probe with it.) The settle walk now re-derives a
  // verdict reader it reaches: the source settling is its verdict changing.
  it("F9: a probe-only isPending settles when a coalesced toggle's re-ask lands silently (A19, A34 (2))", async () => {
    const [src, setSrc] = createSignal(0);
    let verdict: unknown = "unpublished";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const m = createMemo(() => Promise.resolve(src()));
      createRenderEffect(
        () => isPending(m),
        v => {
          verdict = v;
        }
      );
    });
    await drain();
    expect(verdict).toBe(false);
    setSrc(1);
    setSrc(0); // nets to the committed value: no proposal
    await drain(5);
    expect(verdict).toBe(false);
    dispose();
  });

  // F10. A31: "A memo computes under its own lane posture, never its
  // puller's"; A28: "a write becomes visible at flush — to every channel". A
  // gated `isPending` reader revealed in the same tick as a write to the
  // probed memo's source (`setShow(true); setSrc(1)`, memo between) pulled
  // the memo from inside its window: `verdictValue` → `pullComputed(m)` →
  // `m`'s pass read `src` with the window's dispatch still installed, and
  // the unheld-staged arm served it the committed `0`. `m` cached the
  // committed input, its plain reader stayed on the old value for good, and
  // the write never published. The pulled pass now reads outside the window
  // (the probe's own read of `m` answers the verdict afterwards), and a
  // window restores the dispatch it found, so a window inside that pass
  // closes back to none.
  it("F10: a memo an isPending probe pulls computes from the flushed write, which publishes (A31, A28)", async () => {
    const [src, setSrc] = createSignal(0);
    const [show, setShow] = createSignal(false);
    let data: unknown = "unpublished";
    let verdict: unknown = "unpublished";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const m = createMemo(() => src());
      createRenderEffect(m, v => {
        data = v;
      });
      createRenderEffect(
        () => (show() ? isPending(() => m()) : "hidden"),
        v => {
          verdict = v;
        }
      );
    });
    flush();
    expect([data, verdict]).toEqual([0, "hidden"]);
    setShow(true);
    setSrc(1);
    await drain();
    expect([data, verdict]).toEqual([1, false]);
    dispose();
  });

  // F10, nested: the pulled memo's own window (an `isPending` inside its
  // body) closes back to no window, not to the puller's — the rest of the
  // memo's pass is still its own.
  it("F10 (nested window): a memo an isPending probe pulls keeps its own reads outside the probe after its own window closes (A31)", async () => {
    const [src, setSrc] = createSignal(0);
    const [show, setShow] = createSignal(false);
    let data: unknown = "unpublished";
    let verdict: unknown = "unpublished";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const m = createMemo(() => {
        isPending(() => 0);
        return src();
      });
      createRenderEffect(m, v => {
        data = v;
      });
      createRenderEffect(
        () => (show() ? isPending(() => m()) : "hidden"),
        v => {
          verdict = v;
        }
      );
    });
    flush();
    setShow(true);
    setSrc(1);
    await drain();
    expect([data, verdict]).toEqual([1, false]);
    dispose();
  });

  // F11. A31: "A memo computes under its own lane posture, never its
  // puller's" (#3442: the probe's pull of `copy` made it read the in-flight
  // `slow` as its committed value); A19 exc. 1 / A7: an uninitialized source
  // throws, a value is never fabricated. A sibling `isPending(() => [a(),
  // c()])` probe pulls `c` (async over a sync memo over async `a`) during
  // the initial load; `c`'s pass — run inside the probe's window — read the
  // uninitialized `b`'s staging through the unheld-staged arm as
  // `undefined` instead of suspending, and the plain data reader never
  // published at all. F10's change: the pulled pass reads outside the
  // window, as a plain pass, and suspends.
  it("F11: a memo an isPending probe pulls suspends on its uninitialized input (A31, A19 exc. 1)", async () => {
    const [src] = createSignal(0);
    const gates = new Map<string, () => void>();
    const inputsSeen: unknown[] = [];
    let data: unknown = "unpublished";
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const a = createMemo(() => gated(gates, `a:${src()}`, src()));
      const b = createMemo(() => a() + 1);
      const c = createMemo(() => {
        const v = b();
        inputsSeen.push(v);
        return gated(gates, `c:${v}`, v * 10);
      });
      createRenderEffect(
        () => isPending(() => [a(), c()]),
        () => {}
      );
      createRenderEffect(
        () => [a(), c()],
        v => {
          data = v;
        }
      );
    });
    await drain();
    for (const g of [...gates.values()]) {
      g();
      await drain();
    }
    for (const g of [...gates.values()]) {
      g();
      await drain();
    }
    expect(inputsSeen.every(v => Number.isFinite(v))).toBe(true);
    expect(data).toEqual([0, 10]);
    dispose();
  });
});

describe("fuzz findings on L2 — crashes", () => {
  // F7a. A15 (#3698): "lane work never makes its node transaction work: the
  // node is neither queued nor stamped for the action's commit"; ruling A: a
  // held pass's frame is held with it. The two met in `holdFrame`: the
  // remounted gate's pass is the action's (its write to `mounted` joined the
  // hold, A34 (1)) and its new frame is held with it — but the `Loading`'s
  // nodes inside it read `latest(source)` and are the action's verdict lane's
  // (display-ahead, rule 6). `holdFrame` re-listed them on the action's
  // transaction with their lane value (CONFIG_OVERRIDE) still on; at the
  // landing `dissolveLane` no longer found them and `land` nulled their
  // transaction — a lane node with no lane, which the landing's re-derivation
  // read (`laneRead` → `txOf(null)`, REACTIVITY_HALTED). The seam's own hold
  // loop already excludes lane work; `holdFrame` now does the same.
  it("F7a: a Loading remounted over latest(x) mid-hold stays the verdict lane's inside the held frame, and the landing commits (A15 #3698, ruling A)", async () => {
    const captured = captureErrors();
    const [source, setSource] = createSignal(0);
    const [mounted, setMounted] = createSignal(true);
    const gates = new Map<string, () => void>();
    let resume!: () => void;
    let run!: () => Promise<void>;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const derived = createMemo(() => {
        const v = latest(source);
        return gated(gates, `d:${v}`, v);
      });
      createRenderEffect(
        () =>
          mounted()
            ? createRoot(dd => {
                const view = createLoadingBoundary(
                  () => latest(source),
                  () => "loading" as const
                );
                createRenderEffect(view, () => {});
                return dd;
              })
            : undefined,
        dd => {
          if (dd) onCleanup(dd);
        }
      );
      createRenderEffect(derived, () => {});
      run = action(function* () {
        yield new Promise<void>(r => {
          resume = r;
        });
        setSource(1);
      });
    });
    flush();
    gates.get("d:0")!();
    await drain();
    const p = run();
    setMounted(false);
    resume();
    await drain();
    setMounted(true);
    await drain();
    for (const g of [...gates.values()]) {
      g();
      await drain();
    }
    await p.catch(e => captured.errors.push(e));
    await tick();
    captured.stop();
    dispose();
    expect(captured.errors.map(String)).toEqual([]);
  });

  // F7b. The same `holdFrame` re-listing without optimism or boundaries: a
  // verdict memo (`createMemo(() => isPending(() => src()) ? 1 : 0)`) mounted
  // in the tick of the write it probes is the holder's verdict lane's; its
  // mount toggled off and on while the write is held re-creates it inside a
  // frame the hold takes (`holdFrame`), and the flight's landing re-derived a
  // lane node whose lane was gone.
  it("F7b: a verdict memo remounted over a held write stays the verdict lane's inside the held frame, and the landing commits (A15 #3698, rule 6)", async () => {
    const captured = captureErrors();
    const [src, setSrc] = createSignal(0);
    const [mounted, setMounted] = createSignal(false);
    const gates = new Map<string, () => void>();
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const a = createMemo(() => gated(gates, `a:${src()}`, src()));
      createRenderEffect(a, () => {});
      createRenderEffect(
        () =>
          mounted()
            ? createRoot(dd => {
                const v = createMemo(() => (isPending(() => src()) ? 1 : 0));
                createRenderEffect(v, () => {});
                return dd;
              })
            : undefined,
        dd => {
          if (dd) onCleanup(dd);
        }
      );
    });
    flush();
    gates.get("a:0")!();
    await drain();
    setMounted(true);
    setSrc(1); // the probe reader mounts in the tick of the write it probes
    await drain();
    setMounted(false);
    setMounted(true); // re-mounted while the write is held
    await drain();
    gates.get("a:1")!();
    await drain();
    await tick();
    captured.stop();
    dispose();
    expect(captured.errors.map(String)).toEqual([]);
  });

  // F12. A15 first observer (#3458): "when the transaction has NO entry for
  // the flight — it was in flight but nothing displayed it, and this reveal
  // is its first observer — the observation registers it, and the
  // transaction waits on the flight it now shows a reader of." The cycle:
  // the action's end lands its transaction while the async memo's flight —
  // asked as the verdict lane's work (`latest(source)` = the proposal) — is
  // still up; `dissolveLane` commits the memo beneath the flight, which is
  // now nobody's. The landing's `_reruns` re-derive the reader (a stale
  // reader of `show`, held with the action by O1): `show` is true now, the
  // memo is pending and unheld, and the reader — a verdict reader — is served
  // the committed value and `observeFlight`s it: a transaction opens for the
  // frame to hold, but the flight is on no list, so it holds nothing, lands
  // at this very seam, and its `_reruns` re-derive the reader into the same
  // observation — every flush ("Potential Infinite Loop"). `observeFlight`
  // now holds the flight's node in the frame's transaction when nobody holds
  // it: the transaction has an entry for what it shows a reader of, waits
  // for the landing, and re-derives the reader once.
  it("F12: a verdict reader revealing a flight nobody holds registers it with the frame — an action adopting a same-tick reveal of a latest() reader lands once at its end (A15 #3458, A26, O1)", async () => {
    const captured = captureErrors();
    const [source, setSource] = createSignal(0);
    const [show, setShow] = createSignal(false);
    let resume!: () => void;
    let run!: () => Promise<void>;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const node = createMemo(() => Promise.resolve(latest(source)));
      createRenderEffect(
        () => (show() ? [latest(source), node()] : "hidden"),
        () => {}
      );
      run = action(function* () {
        yield new Promise<void>(r => {
          resume = r;
        });
        setSource(1);
      });
    });
    await drain();
    const p = run();
    setShow(true); // same tick as the action's start: adopted by it (O1)
    for (let i = 0; i < 4; i++) await tick();
    resume();
    for (let i = 0; i < 8; i++) await tick();
    await Promise.race([p.catch(e => captured.errors.push(e)), tick()]);
    captured.stop();
    dispose();
    expect(captured.errors.map(String)).toEqual([]);
  });

  // F12, reduced: the action and its lane only manufactured the orphan
  // flight. Any flight nobody holds — here a memo re-asked by a write whose
  // only reader is gated away (its inputs commit, #3305) — revealed to a
  // verdict reader livelocked the same way, and now holds the frame on the
  // flight until it lands.
  it("F12 (reduced): a verdict reader revealing an orphan flight holds the frame on it until it lands (A15 #3458, #3305)", async () => {
    const captured = captureErrors();
    const gates = new Map<string, () => void>();
    const [src, setSrc] = createSignal(0);
    const [show, setShow] = createSignal(false);
    const frames: string[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const m = createMemo(() => gated(gates, `m:${src()}`, src()));
      createRenderEffect(
        () => (show() ? [latest(src), m()] : "hidden"),
        v => {
          frames.push(JSON.stringify(v));
        }
      );
    });
    flush();
    gates.get("m:0")!();
    await drain();
    setSrc(1); // m flies unobserved: src=1 commits, the flight is nobody's
    await drain();
    setShow(true); // the verdict reader is the flight's first observer
    await drain();
    gates.get("m:1")!();
    await drain();
    captured.stop();
    dispose();
    expect(captured.errors.map(String)).toEqual([]);
    // The reveal read `show`'s staging, so the reader is the frame's (L2
    // rule 3) and the reveal waits with the flight it discovered — whose
    // inputs are visible (A15 reveal corollary, #3305): one frame, at the
    // landing.
    expect(frames).toEqual(['"hidden"', "[1,1]"]);
  });
});
