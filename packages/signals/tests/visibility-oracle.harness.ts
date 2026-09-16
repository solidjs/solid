/**
 * Visibility-oracle harness — shared by the signal/memo oracle
 * (visibility-oracle.test.ts) and the store oracle
 * (visibility-oracle-store.test.ts). Model: node states × reader kinds → the
 * value each reader is served; see visibility-oracle.test.ts for the reader
 * definitions and the cell vocabulary (rule / observed / violation).
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  NotReadyError,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  isPending,
  latest,
  until
} from "../src/index.js";

// ── cell values ─────────────────────────────────────────────────────────────
export const HELD = "HELD" as const; // nothing published / the reader is holding
export const NOT_READY = "throws:NotReady" as const;
export type Cell = unknown | typeof HELD | typeof NOT_READY | `throws:${string}`;

export type Expect =
  | { value: Cell; rule: string }
  | { observed: Cell; note: string }
  | { violation: { rule: Cell; current: Cell }; note: string }
  | { na: string };
export const rule = (value: Cell, rule: string): Expect => ({ value, rule });
export const observed = (observed: Cell, note: string): Expect => ({ observed, note });
/** The spec fixes this cell to `rule`; the runtime currently serves `current`.
 * Pinned at `current` so the suite is green; listed red by the report. When
 * the runtime is fixed this cell fails — flip it to `rule(...)`. */
export const violation = (ruleValue: Cell, current: Cell, note: string): Expect => ({
  violation: { rule: ruleValue, current },
  note
});
export const na = (why: string): Expect => ({ na: why });

export const READERS = [
  "untracked",
  "derivesFrom",
  "published",
  "preexisting",
  "staleForeign",
  "childrenForbidden",
  "latest",
  "isPending",
  "authoritative"
] as const;
export type Reader = (typeof READERS)[number];

/** What a state builder returns. `source`: the mainline signal whose ordinary
 * write the state's flight holds (when there is one) — the posture matrix
 * asks whether that write publishes once no visible reader needs the flight. */
export type Built = {
  x: () => unknown;
  dispose: () => void;
  /** The mainline signal whose ordinary write the state's flight holds. */
  source?: () => unknown;
  /** A write to make AFTER the matrix reader exists (the reader observes the
   * flight it opens) — states whose question is about the reader's hold. */
  perturb?: () => void;
};

export type State = {
  name: string;
  /** Build the state. Returns the node accessor and a disposer. The stale
   * foreign reader must be created BEFORE the state is entered, so builders
   * receive a hook to install it. */
  build: (installStale: (x: () => unknown) => void) => Built | Promise<Built>;
  expect: Record<Reader, Expect>;
};

// ── helpers ─────────────────────────────────────────────────────────────────
export const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};
// Every open-ended promise a state creates is registered here and released
// between cells: a never-settling action would otherwise leave its transaction
// live across the next cell (observed: an unrelated async memo's NotReady then
// escaped flush()).
export const holds: Array<() => void> = [];
export const never = () => new Promise<never>(r => holds.push(r as () => void));
export const releaseAll = async () => {
  for (const r of holds.splice(0)) r();
  await settle();
  await settle();
};
const classify = (fn: () => unknown): Cell => {
  try {
    return fn();
  } catch (e) {
    return e instanceof NotReadyError
      ? NOT_READY
      : `throws:${(e as Error)?.constructor?.name ?? String(e)}`;
  }
};

function readCell(
  reader: Reader,
  x: () => unknown,
  stale: { log: Cell[]; bump: () => void } | null
): Cell {
  switch (reader) {
    case "untracked":
      return classify(x);
    case "latest":
      return classify(() => latest(() => x()));
    case "isPending":
      return classify(() => isPending(() => x()));
    case "derivesFrom": {
      const log: Cell[] = [];
      const dispose = createRoot(d => {
        const m = createMemo(() => {
          let v: Cell;
          try {
            v = x();
          } catch (e) {
            log.push(
              e instanceof NotReadyError ? NOT_READY : `throws:${(e as Error)?.constructor?.name}`
            );
            throw e; // suspend like a real derivation
          }
          log.push(v);
          return v;
        });
        createRenderEffect(m, () => {});
        return d;
      });
      flush();
      dispose();
      return log.length ? log[log.length - 1] : HELD;
    }
    case "published": {
      const log: Cell[] = [];
      const dispose = createRoot(d => {
        const m = createMemo(() => x());
        createRenderEffect(m, v => {
          log.push(v);
        });
        return d;
      });
      flush();
      dispose();
      return log.length ? log[log.length - 1] : HELD;
    }
    case "preexisting": {
      if (!stale) return na("no pre-existing reader") as any;
      return stale.log.length ? stale.log[stale.log.length - 1] : HELD;
    }
    case "staleForeign": {
      if (!stale) return na("no stale reader") as any;
      stale.log.length = 0;
      stale.bump();
      flush();
      return stale.log.length ? stale.log[stale.log.length - 1] : HELD;
    }
    case "childrenForbidden": {
      const log: Cell[] = [];
      const dispose = createRoot(d => {
        createTrackedEffect(() => {
          log.push(classify(x));
        });
        return d;
      });
      flush();
      dispose();
      return log.length ? log[log.length - 1] : HELD;
    }
    case "authoritative": {
      let seen: Cell = HELD;
      // until()'s predicate is the authoritative reader; it runs synchronously
      // on the first evaluation. Resolve immediately so nothing is left open.
      until(() => {
        seen = classify(x);
        return true;
      }).catch(() => {});
      flush();
      return seen;
    }
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
export function runOracle(title: string, STATES: State[]): void {
  const unspecified: string[] = [];
  const violations: string[] = [];
  afterEach(async () => {
    await releaseAll();
    flush();
  });
  afterAll(() => {
    if (process.env.VISIBILITY_ORACLE_REPORT)
      require("node:fs").appendFileSync(
        process.env.VISIBILITY_ORACLE_REPORT,
        [
          `# ${title}`,
          "## violations",
          ...violations,
          "",
          "## unspecified",
          ...unspecified,
          ""
        ].join("\n") + "\n"
      );
  });
  describe(title, () => {
    for (const state of STATES) {
      describe(state.name, () => {
        for (const reader of READERS) {
          const exp = state.expect[reader];
          if ("na" in exp) continue;
          const title =
            "value" in exp
              ? `${String(exp.value)} [${exp.rule}]`
              : "violation" in exp
                ? `VIOLATION: rule says ${String(exp.violation.rule)}, runtime serves ${String(exp.violation.current)} (${exp.note})`
                : `${String(exp.observed)} (observed; ${exp.note})`;
          it(`${reader} → ${title}`, async () => {
            let stale: { log: Cell[]; bump: () => void } | null = null;
            const [u, setU] = createSignal(0);
            const installStale = (x: () => unknown) => {
              const log: Cell[] = [];
              createRoot(() => {
                createRenderEffect(
                  () => {
                    u();
                    return x(); // a throw suspends the pass → HELD
                  },
                  v => {
                    log.push(v);
                  }
                );
              });
              flush();
              log.length = 0;
              stale = { log, bump: () => setU(n => n + 1) };
            };
            const built = state.build(installStale);
            const { x, dispose } = built instanceof Promise ? await built : built;
            const got = readCell(reader, x, stale);
            dispose();
            await releaseAll();
            if ("value" in exp) expect(got).toEqual(exp.value);
            else if ("violation" in exp) {
              violations.push(
                `${state.name} × ${reader}: rule ${String(exp.violation.rule)}, runtime ${String(got)} — ${exp.note}`
              );
              expect(got).toEqual(exp.violation.current);
            } else {
              unspecified.push(`${state.name} × ${reader} = ${String(got)} — ${exp.note}`);
              expect(got).toEqual(exp.observed);
            }
          });
        }
      });
    }
  });
}
