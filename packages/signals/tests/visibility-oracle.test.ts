/**
 * Visibility oracle — node state × reader kind → what is served.
 *
 * The runtime decides what a read serves at eleven sites (read, readNodeFast,
 * supersededRead, latestRead, gatedRead, laneReadsCommitted, heldFromStale,
 * store nodeValue/serveDataKey/optimisticView). Every new visibility rule is
 * threaded through them by hand. This file pins the OBSERVABLE outcome per
 * cell so a rule that reaches one site and misses another shows up as a red
 * cell instead of an audit finding.
 *
 * Rows: node states. Columns: reader kinds. Each expected cell cites the rule
 * that fixes it (SPEC-ASYNC-SEMANTICS.md). Cells the spec does not fix are
 * `observed(...)`: pinned as current behavior, listed by `reportUnspecified`
 * so they can be brought to a ruling — changing one is a design decision.
 *
 * Reader kinds:
 * - untracked          x() with no observer
 * - derivesFrom        the value a mainline memo's PASS read (compute-side log)
 * - published          what a render effect over that memo published; HELD if nothing
 * - preexisting        what a render effect built before the state published after it (HELD if nothing)
 * - staleForeign       that same effect re-run by an unrelated mainline write
 * - childrenForbidden  createTrackedEffect reading x
 * - latest             latest(() => x())
 * - isPending          isPending(() => x())
 * - authoritative      until()'s predicate reading x (CONFIG_AUTHORITATIVE_READ)
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  NotReadyError,
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  createTrackedEffect,
  flush,
  isPending,
  latest,
  until
} from "../src/index.js";

/** The #3331 reporter graph: an optimistic computed over an async fetch of a
 * signal, with an async memo downstream. `prime()` lands the initial fetch
 * (and, when `initDownstream`, the downstream's first flight); `supersede()`
 * runs an action that changes the question and guesses wrong, then lands the
 * refetch with the differing truth while the action stays live. */
function supersededGraph(initDownstream: boolean) {
  const [value, setValue] = createSignal(0);
  const fetchResolvers: Array<() => void> = [];
  const flights: Array<() => void> = [];
  let x!: () => unknown;
  let setDouble!: (v: number) => void;
  const dispose = createRoot(d => {
    [x, setDouble] = createOptimistic(() => {
      const v = value();
      return new Promise<number>(r => fetchResolvers.push(() => r(v * 2)));
    });
    const downstream = createMemo(() => {
      const n = x();
      return new Promise<string>(r => flights.push(() => r(`${n}!`)));
    });
    createRenderEffect(downstream, () => {});
    return d;
  });
  holds.push(() => flights.splice(0).forEach(f => f()));
  return {
    x,
    dispose,
    async prime() {
      flush();
      fetchResolvers.shift()!();
      await settle();
      if (initDownstream) {
        flights.shift()!();
        await settle();
      }
    },
    async supersede() {
      const run = action(function* () {
        setValue(1); // new question → refetch
        setDouble(3); // wrong guess; truth will be 2
        yield never();
      });
      run();
      flush();
      fetchResolvers.shift()!(); // own source lands 2 ≠ 3 while the action is live
      await settle();
    }
  };
}

// ── cell values ─────────────────────────────────────────────────────────────
const HELD = "HELD" as const; // nothing published / the reader is holding
const NOT_READY = "throws:NotReady" as const;
type Cell = unknown | typeof HELD | typeof NOT_READY | `throws:${string}`;

type Expect =
  | { value: Cell; rule: string }
  | { observed: Cell; note: string }
  | { violation: { rule: Cell; current: Cell }; note: string }
  | { na: string };
const rule = (value: Cell, rule: string): Expect => ({ value, rule });
const observed = (observed: Cell, note: string): Expect => ({ observed, note });
/** The spec fixes this cell to `rule`; the runtime currently serves `current`.
 * Pinned at `current` so the suite is green; listed red by the report. When
 * the runtime is fixed this cell fails — flip it to `rule(...)`. */
const violation = (ruleValue: Cell, current: Cell, note: string): Expect => ({
  violation: { rule: ruleValue, current },
  note
});
const na = (why: string): Expect => ({ na: why });

const READERS = [
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
type Reader = (typeof READERS)[number];

type State = {
  name: string;
  /** Build the state. Returns the node accessor and a disposer. The stale
   * foreign reader must be created BEFORE the state is entered, so builders
   * receive a hook to install it. */
  build: (
    installStale: (x: () => unknown) => void
  ) =>
    | { x: () => unknown; dispose: () => void }
    | Promise<{ x: () => unknown; dispose: () => void }>;
  expect: Record<Reader, Expect>;
};

// ── helpers ─────────────────────────────────────────────────────────────────
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flush();
};
// Every open-ended promise a state creates is registered here and released
// between cells: a never-settling action would otherwise leave its transaction
// live across the next cell (observed: an unrelated async memo's NotReady then
// escaped flush()).
let holds: Array<() => void> = [];
const never = () => new Promise<never>(r => holds.push(r as () => void));
const releaseAll = async () => {
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

// ── states ──────────────────────────────────────────────────────────────────
const STATES: State[] = [
  {
    name: "committed (signal, no write)",
    build(installStale) {
      const [x] = createSignal(0);
      installStale(x);
      return { x, dispose() {} };
    },
    expect: {
      untracked: rule(0, "baseline"),
      derivesFrom: rule(0, "baseline"),
      published: rule(0, "baseline"),
      preexisting: rule(HELD, "baseline: nothing new to publish"),
      staleForeign: rule(0, "baseline"),
      childrenForbidden: rule(0, "baseline"),
      latest: rule(0, "baseline"),
      isPending: rule(false, "baseline"),
      authoritative: rule(0, "baseline")
    }
  },
  {
    name: "staged, ambient (set(1) before the flush)",
    build(installStale) {
      const [x, set] = createSignal(0);
      installStale(x);
      set(1);
      return { x, dispose() {} };
    },
    expect: {
      // Readers that flush observe the write land — trivially 1.
      untracked: observed(
        0,
        "pre-flush untracked read serves committed; A28 (#3337, unmerged) rules on this tick"
      ),
      derivesFrom: rule(1, "the flush carries the write"),
      published: rule(1, "the flush carries the write"),
      preexisting: observed(HELD, "pre-flush: nothing has run yet"),
      staleForeign: rule(1, "the flush carries the write"),
      childrenForbidden: rule(1, "the flush carries the write"),
      latest: observed(
        1,
        "pre-flush latest() serves the unflushed write; A28 (#3337) would make this 0 until the flush"
      ),
      isPending: observed(
        true,
        "pre-flush verdict flips on the unflushed write; A28 (#3337) territory"
      ),
      authoritative: observed(
        1,
        "until() predicate pre-flush sees the unflushed write; A28 (#3337) territory"
      )
    }
  },
  {
    name: "held by a live action (set(1) inside action, yield forever)",
    build(installStale) {
      const [x, set] = createSignal(0);
      installStale(x);
      const run = action(function* () {
        set(1);
        yield never();
      });
      run(); // imperative scope: the test body
      flush();
      return { x, dispose() {} };
    },
    expect: {
      untracked: rule(
        0,
        "A19 (i): the observable value is the committed one while the write is held"
      ),
      derivesFrom: rule(
        1,
        "A29: a tracked pass served the staged value derives from the transaction's world"
      ),
      published: violation(
        HELD,
        1,
        "A29: a fresh mainline memo + render effect created during the hold publishes the HELD value into the mainline frame; a fresh effect reading the signal directly, and pre-existing readers, correctly show 0"
      ),
      preexisting: rule(HELD, "A19 (i): the held write is not on screen"),
      staleForeign: rule(
        0,
        "A15 reveal corollary / A26: a stale reader of a parallel transaction shows committed, no entanglement"
      ),
      childrenForbidden: rule(
        0,
        "A32: children-forbidden readers see the frame; a held write is never visible to them"
      ),
      latest: rule(1, "A8/A11: the held value exists from the write; latest serves it"),
      isPending: rule(true, "A19 (i)"),
      authoritative: rule(
        1,
        "A17 carve-out (2026-09-14): until() reads the landed world — the staged value"
      )
    }
  },
  {
    name: "override active (createOptimistic set to 5 inside a live action)",
    build(installStale) {
      let x!: () => unknown;
      let setO!: (v: number) => void;
      const dispose = createRoot(d => {
        [x, setO] = createOptimistic(0);
        return d;
      });
      installStale(x);
      const run = action(function* () {
        setO(5);
        yield never();
      });
      run();
      flush();
      return { x, dispose };
    },
    expect: {
      untracked: rule(5, "A17: the override is the displayed value"),
      derivesFrom: rule(5, "A17: the override is the graph's value until its own source answers"),
      published: observed(
        5,
        "A17: direct read shows optimistic; whether a mainline memo over it publishes or holds is not stated"
      ),
      preexisting: rule(
        5,
        "A17: the override is the displayed value; no downstream async, so the lane has nothing to wait for"
      ),
      staleForeign: rule(5, "A17: the applied frame shows the override"),
      childrenForbidden: rule(5, "A32: the override is the frame; it shows through"),
      latest: rule(5, "A17 / OL-R11: the override is the value on every channel"),
      isPending: rule(false, "A24 (3): optimistic writes are verdict-inert"),
      authoritative: rule(0, "A17: until()'s predicate never sees the caller's own optimism")
    }
  },
  {
    name: "override, ambient (createOptimistic set to 5 outside any action, before the flush)",
    build(installStale) {
      let x!: () => unknown;
      let setO!: (v: number) => void;
      const dispose = createRoot(d => {
        [x, setO] = createOptimistic(0);
        return d;
      });
      installStale(x);
      setO(5);
      return { x, dispose };
    },
    expect: {
      untracked: rule(5, "OL-R2: synchronously visible before any flush"),
      derivesFrom: rule(
        0,
        "OL-R5: an ambient optimistic write reverts at the next flush (the flush the reader forces)"
      ),
      published: rule(0, "OL-R5"),
      preexisting: observed(HELD, "pre-flush: nothing has run yet"),
      staleForeign: rule(0, "OL-R5"),
      childrenForbidden: rule(0, "OL-R5"),
      latest: rule(5, "OL-R11 pre-flush"),
      isPending: rule(false, "A24 (3)"),
      authoritative: rule(
        0,
        "A17 carve-out: never the caller's optimism (and the ambient override reverts at the flush the reader forces)"
      )
    }
  },
  {
    name: "superseded (own source landed 2 ≠ override 3; initialized downstream flight keeps the action live)",
    async build(installStale) {
      const built = supersededGraph(true);
      await built.prime();
      installStale(built.x);
      await built.supersede();
      return built;
    },
    expect: {
      untracked: rule(
        3,
        "A18 (c): untracked reads keep the override until the transaction commits"
      ),
      derivesFrom: rule(2, "A18 (b): tracked derivations recompute from the arrived value"),
      published: violation(
        HELD,
        2,
        "A18 (c): a fresh mainline memo + render effect over the superseded node publishes the TRUTH (2) while a fresh DIRECT render effect in the same root publishes the override (3) and every pre-existing reader holds — a tear between readers of one frame"
      ),
      preexisting: rule(HELD, "A18 (c): the applied frame keeps the override until commit"),
      staleForeign: rule(
        3,
        "A18 (c) / A17 amended: a stale reader of another transaction displays the override"
      ),
      childrenForbidden: rule(3, "A32: the displayed override shows through, superseded or not"),
      latest: rule(2, "A18 (d): latest returns the arrived value"),
      isPending: rule(true, "A18 (d): pending iff the arrival differs from the override"),
      authoritative: rule(2, "A17 carve-out: the authoritative reader sees the staged truth")
    }
  },
  {
    name: "superseded, downstream never initialized (its first flight never lands)",
    async build(installStale) {
      const built = supersededGraph(false);
      await built.prime();
      installStale(built.x);
      await built.supersede();
      return built;
    },
    expect: {
      untracked: rule(3, "A18 (c)"),
      derivesFrom: rule(2, "A18 (b)"),
      published: violation(HELD, 2, "as above"),
      preexisting: observed(
        HELD,
        "this reader (created after the node initialized) holds. A render effect on the node created BEFORE its first landing published the truth (2) at the supersession in a side probe — while untracked reads still served 3 — so the hold here is shape-dependent; follow-up"
      ),
      staleForeign: observed(3, "displays the override, as in the initialized case"),
      childrenForbidden: rule(3, "A32"),
      latest: rule(2, "A18 (d)"),
      isPending: violation(
        true,
        false,
        "A18 (d): the arrival differs from the override yet the verdict is false — the uninitialized downstream reporter is not counted as observing the flight"
      ),
      authoritative: rule(2, "A17 carve-out")
    }
  },
  {
    name: "pending own async (initialized memo refetching on a new question, flight up)",
    async build(installStale) {
      const [q, setQ] = createSignal(0);
      const resolvers: Array<(v: number) => void> = [];
      let x!: () => unknown;
      const dispose = createRoot(d => {
        const m = createMemo(() => {
          const v = q();
          return new Promise<number>(r => resolvers.push(r)).then(() => v * 10);
        });
        x = m;
        createRenderEffect(m, () => {});
        return d;
      });
      flush();
      resolvers.shift()!(0);
      await settle();
      installStale(x);
      setQ(1); // new question; flight never lands
      flush();
      return { x, dispose };
    },
    expect: {
      untracked: rule(
        0,
        "A19 (ii): the observable value is the committed one while the node's own async is in flight"
      ),
      derivesFrom: rule(
        NOT_READY,
        "A15: a fresh derivation suspends on the observed flight. (With no reader holding on the flight the pass reads the committed value instead and the reveal holds — the frame is identical; observation-driven transactions make the difference inherent, ruled 2026-09-14.)"
      ),
      published: rule(HELD, "A15"),
      preexisting: rule(HELD, "A15: the reader that observed the flight holds"),
      staleForeign: observed(
        0,
        "A15 reveal corollary says a stale reader holds when the flight's inputs are published (#3305); here the new question was a mainline write and the reader shows the pre-flight committed value — does INPUTS_PUBLISHED cover a flight opened by the same batch?"
      ),
      childrenForbidden: rule(0, "A32: a pending node's committed value is the frame"),
      latest: rule(
        0,
        "A8: latest shows the stale value while the own fetch for a new question is in flight"
      ),
      isPending: rule(true, "A19 (ii) / A24 (2): a new question pends"),
      authoritative: rule(
        NOT_READY,
        "A17 carve-out: nothing has landed for the new question; the predicate suspends like any reader"
      )
    }
  },
  {
    name: "uninitialized (memo whose first flight never lands)",
    build(installStale) {
      let x!: () => unknown;
      const dispose = createRoot(d => {
        const m = createMemo(() => never());
        x = m;
        createRenderEffect(m, () => {});
        return d;
      });
      installStale(x);
      flush();
      return { x, dispose };
    },
    expect: {
      untracked: rule(
        NOT_READY,
        "A19 exception (1): loading, not pending — the NotReady propagates"
      ),
      derivesFrom: rule(
        NOT_READY,
        "A16 carve-out (B5a): tracked contexts propagate NotReady to loading boundaries"
      ),
      published: rule(HELD, "A19 exception (1)"),
      preexisting: rule(HELD, "A19 exception (1)"),
      staleForeign: rule(
        HELD,
        "A15 reveal corollary: an uninitialized node has no committed value to show"
      ),
      childrenForbidden: rule(NOT_READY, "A32: no frame to read yet"),
      latest: rule(
        NOT_READY,
        "A7 (amended 2026-09-14): latest() of an uninitialized node throws in every scope, never undefined"
      ),
      isPending: rule(
        false,
        "A16: an unowned isPending never throws; A19 exception (1): loading is not pending"
      ),
      authoritative: rule(NOT_READY, "A17 carve-out: nothing landed")
    }
  },
  {
    name: "loading window (createMemo with loadingValue -1, first flight up)",
    build(installStale) {
      let x!: () => unknown;
      const dispose = createRoot(d => {
        const m = createMemo(() => never(), { loadingValue: -1 });
        x = m;
        createRenderEffect(m, () => {});
        return d;
      });
      installStale(x);
      flush();
      return { x, dispose };
    },
    expect: {
      untracked: rule(-1, "A27: the loading value is commit #0"),
      derivesFrom: rule(-1, "A27: never suspends readers during the first flight"),
      published: rule(-1, "A27"),
      preexisting: rule(HELD, "A27: the loading value was published before the state; nothing new"),
      staleForeign: rule(-1, "A27"),
      childrenForbidden: rule(-1, "A27: loading-class, no suspension"),
      latest: rule(-1, "A27"),
      isPending: rule(false, "A27: verdict-quiet"),
      authoritative: rule(
        -1,
        "A17 carve-out / A27: the loading value is commit #0 — landed by declaration"
      )
    }
  }
];

// ── run ─────────────────────────────────────────────────────────────────────
const unspecified: string[] = [];
const violations: string[] = [];
afterEach(async () => {
  await releaseAll();
  flush();
});

afterAll(() => {
  if (process.env.VISIBILITY_ORACLE_REPORT)
    require("node:fs").writeFileSync(
      process.env.VISIBILITY_ORACLE_REPORT,
      ["# violations", ...violations, "", "# unspecified", ...unspecified].join("\n") + "\n"
    );
});

describe("visibility oracle (A7, A15, A16, A17, A18, A19, A24, A26, A27, A29, A32)", () => {
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
