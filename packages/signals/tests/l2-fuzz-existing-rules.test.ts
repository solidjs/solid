/**
 * L2-rewrite regressions under existing rules, from the semantic fuzzer's
 * comparison of pre-L2 `41fdf9696` against `next` `49a8dca84` (rev-19
 * oracle, seeds 3289 and 91501, 1000 cases per cohort; `latest` cohort
 * unless noted). The shapes are the fuzzer's reductions translated to
 * primitives. The drain is host tasks only: an explicit `flush()` between
 * steps hides every one of them (the frames meet in one flush).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  onCleanup,
  onSettled
} from "../src/index.js";

const task = () => new Promise<void>(r => setTimeout(r, 0));
async function drain(n = 2) {
  for (let i = 0; i < n; i++) await task();
}
/** A settled-probe, as the fuzzer's harness registers one per step. */
const probe = () => onSettled(() => {});
/** A manual flight per captured input, so each landing is chosen by the test. */
function gated<T>(gates: Map<string, () => void>, key: string, value: T): Promise<T> {
  return new Promise<T>(r => {
    gates.set(key, () => r(value));
  });
}
function resolveAll(gates: Map<string, () => void>) {
  const all = [...gates.values()];
  gates.clear();
  for (const g of all) g();
}

describe("superseded value left showing after completion (A15 lanes corollary, A18 body end)", () => {
  // A verdict-lane derivation still in flight when its parent lands commits
  // beneath inputs that are now the truth (#3305's commit beneath a flight):
  // a fresh reader of its flight observes it. The dissolution committed the
  // node without the mark, so a mount after the body's authoritative write
  // was served the superseded committed value through the verdict branch and
  // shown ahead of its control — `[1, 0]` delivered (seed 3289 #188, 10
  // cases; #3 the same).
  it("a mount over a flight the landing committed beneath its inputs observes the flight", async () => {
    const [s, setS] = createSignal(0);
    const [mounted, setMounted] = createSignal(false);
    const gates = new Map<string, () => void>();
    const delivered: unknown[] = [];
    let resume!: () => void;
    let run!: () => Promise<void>;
    let shownMounted: unknown;
    let out: unknown = "absent";
    const dispose = createRoot(d => {
      const n0 = createMemo(() => {
        const v = latest(s);
        return gated(gates, `n0:${v}`, v);
      });
      createRenderEffect(mounted, v => {
        shownMounted = v;
      });
      createRenderEffect(
        () =>
          mounted()
            ? createRoot(dd => {
                createRenderEffect(
                  () => [latest(s), n0()],
                  v => {
                    out = v;
                    delivered.push(v);
                  }
                );
                onCleanup(() => {
                  out = "absent";
                });
                return dd;
              })
            : undefined,
        dd => {
          if (dd) onCleanup(dd);
        }
      );
      run = action(function* () {
        setS(0);
        probe();
        yield new Promise<void>(r => {
          resume = r;
        });
        setS(1);
        probe();
      });
      return d;
    });
    flush();
    resolveAll(gates);
    await drain();
    const p = run();
    resume(); // the body ends on the authoritative s = 1; n0 re-asks
    await drain();
    setMounted(true);
    probe();
    await drain();
    expect([shownMounted, out]).toEqual([false, "absent"]);
    resolveAll(gates);
    await drain();
    await p;
    await drain();
    expect([shownMounted, out]).toEqual([true, [1, 1]]);
    expect(delivered).toEqual([[1, 1]]);
    dispose();
  });

  // "Correction display is what showed" (2026-10-05): a corrected lane that
  // had shown keeps its runs — but only the runs its seam would have
  // released. A shown lane that re-guessed and was held on a flight for the
  // re-guess parked runs showing a re-guess no frame revealed; the truth's
  // correction released them, and a reader whose derivation was already
  // committed to the shown value stayed on the void re-guess for good
  // (optimistic-readiness seed 91501 #453).
  it("a correction of a shown lane drops the runs its held re-guess parked", async () => {
    const [s, setS] = createSignal(0);
    const gates = new Map<string, () => void>();
    const resumes: Array<() => void> = [];
    const r0: unknown[] = [];
    const r1: unknown[] = [];
    let run!: () => Promise<void>;
    const dispose = createRoot(d => {
      const [o, setO] = createOptimistic(() => s());
      const n0 = createMemo(() => {
        const v = o();
        return gated(gates, `n0:${v}`, v);
      });
      const n1 = createMemo(() => o());
      createRenderEffect(
        () => [n0()],
        v => void r0.push(v)
      );
      createRenderEffect(
        () => [n1()],
        v => void r1.push(v)
      );
      run = action(function* () {
        setO(1);
        probe();
        yield new Promise<void>(r => resumes.push(r));
        setO(0); // re-guess: held on n0's flight for 0
        probe();
        yield new Promise<void>(r => resumes.push(r));
        setS(1); // the truth corrects the lane mid-body
        probe();
      });
      return d;
    });
    flush();
    resolveAll(gates);
    await drain();
    const p = run();
    await drain();
    gates.get("n0:1")!(); // the lane's first guess reveals
    gates.delete("n0:1");
    await drain();
    expect([r0.at(-1), r1.at(-1)]).toEqual([[1], [1]]);
    resumes.shift()!();
    await drain();
    resumes.shift()!();
    await drain();
    resolveAll(gates);
    await drain();
    resolveAll(gates);
    await drain();
    await p;
    await drain();
    expect(r0).toEqual([[0], [1]]);
    expect(r1).toEqual([[0], [1]]);
    dispose();
  });
});

describe("mount reads a memo over a lane flight (F8 memo between: born held, control and child together)", () => {
  // A lane pass's pending propagation listed every subscriber of the node as
  // lane work — the mount's child too, while its own mainline pass was
  // pulling the memo (seed 3289 #603; #289, #145, #918 the same), or after
  // it was born held in the mount's transaction (seed 91501 #908, the
  // body-end re-ask). Listed on the lane, the frame no longer held on it:
  // the mount control published beside a child that showed nothing.
  it("a mainline mount over an existing memo of a never-shown lane flight is born held", async () => {
    const [s, setS] = createSignal(0);
    const [mounted, setMounted] = createSignal(false);
    const gates = new Map<string, () => void>();
    let resume!: () => void;
    let run!: () => Promise<void>;
    let shownMounted: unknown;
    let out: unknown = "absent";
    const dispose = createRoot(d => {
      const n0 = createMemo(() => {
        const v = latest(s);
        return gated(gates, `n0:${v}`, v);
      });
      const n1 = createMemo(() => n0());
      createRenderEffect(mounted, v => {
        shownMounted = v;
      });
      createRenderEffect(
        () =>
          mounted()
            ? createRoot(dd => {
                createRenderEffect(
                  () => [n1()],
                  v => {
                    out = v;
                  }
                );
                onCleanup(() => {
                  out = "absent";
                });
                return dd;
              })
            : undefined,
        dd => {
          if (dd) onCleanup(dd);
        }
      );
      run = action(function* () {
        setS(1);
        yield new Promise<void>(r => {
          resume = r;
        });
        setS(0);
      });
      return d;
    });
    flush();
    await drain();
    resolveAll(gates);
    await drain();
    const p = run(); // n0 re-asks for 1 in the verdict lane, never shown
    await drain();
    setMounted(true);
    await drain();
    expect([shownMounted, out]).toEqual([false, "absent"]);
    resume();
    for (let i = 0; i < 3; i++) {
      resolveAll(gates);
      await drain();
      if (shownMounted) break;
      expect(out).toBe("absent");
    }
    await p;
    await drain();
    expect([shownMounted, out]).toEqual([true, [0]]);
    dispose();
  });

  it("a born-held mount stays held when the body's correction re-asks the lane's flight", async () => {
    const [s, setS] = createSignal(0);
    const [mounted, setMounted] = createSignal(false);
    const gates = new Map<string, () => void>();
    let resume!: () => void;
    let run!: () => Promise<void>;
    let shownMounted: unknown;
    let out: unknown = "absent";
    const dispose = createRoot(d => {
      const n0 = createMemo(() => Promise.resolve(latest(s)));
      const n1 = createMemo(() => {
        const v = n0();
        return gated(gates, `n1:${v}`, v);
      });
      createRenderEffect(mounted, v => {
        shownMounted = v;
      });
      createRenderEffect(
        () =>
          mounted()
            ? createRoot(dd => {
                createRenderEffect(
                  () => [n1()],
                  v => {
                    out = v;
                  }
                );
                onCleanup(() => {
                  out = "absent";
                });
                return dd;
              })
            : undefined,
        dd => {
          if (dd) onCleanup(dd);
        }
      );
      run = action(function* () {
        setS(1);
        yield new Promise<void>(r => {
          resume = r;
        });
        setS(0);
      });
      return d;
    });
    flush();
    await drain();
    resolveAll(gates);
    await drain();
    const p = run();
    await drain();
    setMounted(true);
    probe();
    await drain();
    expect([shownMounted, out]).toEqual([false, "absent"]);
    resume(); // the body ends on s = 0: n0 re-asks as the verdict lane's
    await drain();
    expect([shownMounted, out]).toEqual([false, "absent"]);
    resolveAll(gates);
    await drain();
    await p;
    await drain();
    expect([shownMounted, out]).toEqual([true, [0]]);
    dispose();
  });
});

describe("tear after the action body ends (A15 reveal corollary, A18 body end)", () => {
  // The body's authoritative write lands the transaction while a verdict
  // lane derivation is in flight: it commits beneath its inputs (#3305). A
  // verdict reader that is a memo — a boundary's content — was still handed
  // its committed value beside `latest(s)` = the truth (seed 3289 #922).
  // The reveal corollary has no reader-kind exception: the reader observes
  // the flight, as a render effect does.
  it("a verdict memo does not serve a flight committed beneath its inputs", async () => {
    const [s, setS] = createSignal(0);
    const outs: unknown[] = [];
    let resume!: () => void;
    let run!: () => Promise<void>;
    const dispose = createRoot(d => {
      const n0 = createMemo(() => Promise.resolve(latest(s)));
      const n1 = createMemo(() => Promise.resolve(n0()));
      const view = createLoadingBoundary(
        () => [latest(s), n1()],
        () => "loading",
        { on: s }
      );
      createRenderEffect(view, v => void outs.push(v));
      run = action(function* () {
        setS(0);
        yield new Promise<void>(r => {
          resume = r;
        });
        setS(1);
      });
      return d;
    });
    flush();
    await drain();
    const p = run();
    probe();
    await drain();
    resume();
    await drain();
    await p;
    await drain(3);
    expect(outs).toEqual(["loading", [0, 0], "loading", [1, 1]]);
    dispose();
  });
});
