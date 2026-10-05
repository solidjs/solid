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
  // hold lands (mount nets to committed) — and the reader survives it as a
  // zombie no longer owned by any transaction, keeping an unrelated write
  // (`src=0`, held only because the zombie observes its flight) unpublished
  // although nothing on screen waits on anything (fuzzer P1).
  it.fails(
    "F3: a born-held reader dies with the commit that withdraws its mount, releasing an unrelated write (A29 ruling A, A15 #3463)",
    async () => {
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
    }
  );

  // F4. A15: "writes whose async work is observed by a shared reader settle
  // as one unit (no tearing — nothing commits until all entangled async
  // resolves)"; A30: "an errored pass (a throw, NotReady included) keeps its
  // full list". The tuple reader observed m0's flight for `a=1`; a later
  // `b=1` re-runs it and the pass throws NotReady at `m1` before reaching
  // `m0`. `blockedBy` reads only the pass's reads up to `_depsTail` (the O3
  // "stopped reading" rule), so the unreached `m0` counts as dropped, the
  // hold on `a=1` lands, and `A=1` shows beside a tuple still derived from
  // `a=0` while m0's flight is in the air.
  it.fails(
    "F4: a NotReady-interrupted pass still observes the flights it did not reach (A15, A30)",
    async () => {
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
    }
  );
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
});

describe("fuzz findings on L2 — verdicts", () => {
  // F9. A19: "`isPending(x)` ≡ the observable value is not final … final the
  // moment [no cause] holds it"; A34 (2): a tick whose writes net to the
  // committed value "pends nothing: `isPending` stays false". `setSrc(1);
  // setSrc(0)` re-asks the async memo for the committed input; the quiet
  // re-ask lands and nothing is held — yet a probe-only reader of the memo
  // reads `true` forever. (With a plain data reader beside it the verdict
  // settles; the probe alone is stranded.)
  it.fails(
    "F9: a probe-only isPending settles after a coalesced toggle's re-ask lands (A19, A34 (2))",
    async () => {
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
    }
  );

  // F10. A28: "a write becomes visible at flush — to every channel". A gated
  // `isPending` reader revealed in the same tick as a write to the probed
  // memo's source (`setShow(true); setSrc(1)`, memo between) leaves the
  // memo's plain reader on the old value for good: no flight exists, the
  // verdict reads `false`, and the write is never published. (Writing first,
  // or probing the signal directly, is fine.)
  it.fails(
    "F10: a sync write beside a same-tick reveal of a gated isPending reader publishes (A28)",
    async () => {
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
    }
  );

  // F11. A31: "A memo computes under its own lane posture, never its
  // puller's" (#3442: the probe's pull of `copy` made it read the in-flight
  // `slow` as its committed value); A19 exc. 1 / A7: an uninitialized source
  // throws, a value is never fabricated. A sibling `isPending(() => [a(),
  // c()])` probe pulls `c` (async over a sync memo over async `a`) during
  // the initial load; `c`'s pass reads `b` as `undefined` instead of
  // suspending, and the plain data reader never publishes at all.
  it.fails(
    "F11: a memo pulled by an isPending probe suspends on its uninitialized input (A31, A19 exc. 1)",
    async () => {
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
    }
  );
});

describe("fuzz findings on L2 — crashes", () => {
  // F7a. A TypeError is never spec-conformant. `laneRead` → `txOf(el)` →
  // `resolveTx(null)`: a lane node whose `_x._transaction` is null. Shape: an
  // async derivation of `latest(source)` with a render reader; a `Loading`
  // whose content reads `latest(source)`, mounted before the action,
  // unmounted during its hold and remounted; the derivation's landing for the
  // held value halts the system (REACTIVITY_HALTED).
  it.fails(
    "F7a: remounting a Loading over latest(x) during a hold does not crash the landing (lanes.ts laneRead)",
    async () => {
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
    }
  );

  // F7b. The same TypeError without lanes or boundaries: a verdict memo
  // (`createMemo(() => isPending(() => src()) ? 1 : 0)`) mounted in the same
  // tick as the write it probes (held by a flight), its mount toggled off and
  // on while held; the flight's landing halts the system.
  it.fails(
    "F7b: remounting a verdict memo over a held write does not crash the landing (lanes.ts laneRead)",
    async () => {
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
    }
  );

  // F12. Livelock: "Potential Infinite Loop Detected" from the scheduler's
  // guard — every flush opens and lands a transaction holding nothing. Shape:
  // an action whose body ends with a write; a gate flipped true in the tick
  // the action started (adopted by it, O1); a reader of `latest(source)` and
  // an async memo of `source`. (The pre-carve record names this pattern: "a
  // verdict reader of the pending, un-held derive opened a holding-nothing
  // transaction per flush".)
  it.fails(
    "F12: an action adopting a same-tick reveal of a latest() reader does not livelock at its end (A26, O1)",
    async () => {
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
    }
  );
});
