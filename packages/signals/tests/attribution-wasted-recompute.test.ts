/**
 * WASTED_RECOMPUTE — a scope whose equality gate closes almost every time.
 *
 * Claim under test: a scope that re-runs `minRuns`+ times in a window, with
 * `ratio` or more of the runs producing an unchanged value and `budgetMs`+ of
 * compute in all, is reported once per window with the input that keeps
 * triggering it. Runs that change the value, held/overlay runs, and a scope
 * whose waste is cheap are not reported. `checks: false` folds it off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution, costs } from "../src/attribution.js";
import type { AttributionOptions } from "../src/attribution.js";
import {
  createEffect,
  createMemo,
  createProjection,
  createRoot,
  createSignal,
  flush,
  OBSERVE,
  untrack
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

const WASTE = { minRuns: 5, ratio: 0.8, budgetMs: 0, windowMs: 60_000 };

function capture(opts: AttributionOptions = {}) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  attribution.enable({
    log: false,
    hotRuns: false,
    hotTime: false,
    unstableMemos: false,
    wastedRecompute: WASTE,
    ...opts
  });
  const events: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "WASTED_RECOMPUTE") events.push(e);
  });
  return { events, warn };
}

/** A memo over a whole object that only uses one field: every write to the other field is waste. */
function coarseReader() {
  const [user, setUser] = createSignal({ name: "Ada", visits: 0 }, { name: "user" });
  const greeting = createMemo(() => `Hello, ${user().name}`, { name: "greeting" });
  createRoot(() =>
    createEffect(
      () => greeting(),
      () => {},
      { name: "header" }
    )
  );
  flush();
  return { setUser, greeting };
}

describe("WASTED_RECOMPUTE", () => {
  it("warns once when most of a scope's runs in the window changed nothing", () => {
    const { setUser, greeting } = coarseReader();
    const { events, warn } = capture();
    for (let i = 1; i <= 8; i++) {
      setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(greeting()).toBe("Hello, Ada");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code: "WASTED_RECOMPUTE",
      kind: "perf",
      severity: "warn",
      nodeName: "greeting",
      data: { runs: 5, wasted: 5, windowMs: 60_000, causes: ["user"] }
    });
    expect(events[0].message).toContain('memo "greeting" re-ran 5 times');
    expect(events[0].message).toContain("equality boundary upstream");
    expect(events[0].message).toContain('Latest cause: "user" (write)');
    expect(warn).toHaveBeenCalled();
  });

  it("a scope whose runs change its value is not waste", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    const doubled = createMemo(() => n() * 2, { name: "doubled" });
    createRoot(() =>
      createEffect(
        () => doubled(),
        () => {},
        { name: "reader" }
      )
    );
    flush();
    const { events } = capture();
    for (let i = 1; i <= 8; i++) {
      setN(i);
      flush();
    }
    expect(events).toHaveLength(0);
  });

  it("below the ratio, below the run count, or under the budget: silent", () => {
    const [n, setN] = createSignal(0, { name: "n" });
    // Changes every other run: 50% waste, under the 80% ratio.
    const half = createMemo(() => Math.floor(n() / 2), { name: "half" });
    createRoot(() =>
      createEffect(
        () => half(),
        () => {},
        { name: "reader" }
      )
    );
    flush();
    const { events } = capture();
    for (let i = 1; i <= 10; i++) {
      setN(i);
      flush();
    }
    expect(events).toHaveLength(0);

    attribution.disable();
    const few = coarseReader();
    const under = capture({ wastedRecompute: { ...WASTE, minRuns: 20 } });
    for (let i = 1; i <= 8; i++) {
      few.setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(under.events).toHaveLength(0);

    attribution.disable();
    const cheap = coarseReader();
    const budget = capture({ wastedRecompute: { ...WASTE, budgetMs: 10_000 } });
    for (let i = 1; i <= 8; i++) {
      cheap.setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(budget.events).toHaveLength(0);
  });

  it("`checks: false` folds it off with the other cost checks; `false` alone disables it", () => {
    const a = coarseReader();
    const off = capture({ checks: false });
    for (let i = 1; i <= 8; i++) {
      a.setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(off.events).toHaveLength(0);

    attribution.disable();
    const b = coarseReader();
    const disabled = capture({ wastedRecompute: false });
    for (let i = 1; i <= 8; i++) {
      b.setUser({ name: "Ada", visits: i });
      flush();
    }
    expect(disabled.events).toHaveLength(0);
  });

  describe("named reads", () => {
    /** A prop getter over a row object that is replaced on every update, as a list row's props are. */
    function rowProps() {
      const [row, setRow] = createSignal({ text: "Hello", version: 0 }, { name: "row" });
      const props = {
        get text() {
          const value = row().text;
          OBSERVE!.attribution.noteRead!("props.text", value, "props.text of <Markdown>");
          return value;
        },
        get version() {
          const value = row().version;
          OBSERVE!.attribution.noteRead!("props.version", value, "props.version of <Markdown>");
          return value;
        }
      };
      return { props, setRow };
    }

    function observe(read: () => unknown) {
      createRoot(() =>
        createEffect(
          () => read(),
          () => {},
          { name: "view" }
        )
      );
    }

    it("names the read that returned the same value on every wasted run", () => {
      const { props, setRow } = rowProps();
      const { events } = capture();
      const html = createMemo(() => `<p>${props.text}</p>`, { name: "html" });
      observe(html);
      flush();
      for (let i = 1; i <= 8; i++) {
        setRow({ text: "Hello", version: i });
        flush();
      }
      expect(events).toHaveLength(1);
      expect(events[0].data).toMatchObject({ unchangedReads: ["props.text of <Markdown>"] });
      expect(events[0].message).toContain(
        "Every wasted run read props.text of <Markdown> and got the same value"
      );
      expect(events[0].message).toContain("createMemo(() => props.text)");
    });

    it("a read whose value changed on those runs is not named", () => {
      const { props, setRow } = rowProps();
      const { events } = capture();
      const label = createMemo(() => (props.version, props.text.length > 0 ? "ready" : "empty"), {
        name: "label"
      });
      observe(label);
      flush();
      for (let i = 1; i <= 8; i++) {
        setRow({ text: "Hello", version: i });
        flush();
      }
      expect(events).toHaveLength(1);
      expect(events[0].data).toMatchObject({ unchangedReads: ["props.text of <Markdown>"] });
      expect(events[0].message).not.toContain("props.version");
    });

    it("an untracked read is never named: it cannot re-run the scope", () => {
      const { props, setRow } = rowProps();
      const [tick, setTick] = createSignal(0, { name: "tick" });
      const { events } = capture();
      const status = createMemo(() => (tick(), untrack(() => props.text), "idle"), {
        name: "status"
      });
      observe(status);
      flush();
      for (let i = 1; i <= 8; i++) {
        setRow({ text: "Hello", version: i });
        setTick(i);
        flush();
      }
      expect(events).toHaveLength(1);
      expect(events[0].data).not.toHaveProperty("unchangedReads");
    });

    it("a read made on only some of the wasted runs is not named", () => {
      const { props, setRow } = rowProps();
      const { events } = capture();
      let run = 0;
      const html = createMemo(
        () => {
          run++;
          // Reads the row on every run, but `props.text` only on the first few.
          const row = props.version;
          return run <= 3 ? `<p>${props.text}</p>`.length > 0 : row >= 0;
        },
        { name: "html" }
      );
      observe(html);
      flush();
      for (let i = 1; i <= 8; i++) {
        setRow({ text: "Hello", version: i });
        flush();
      }
      expect(events).toHaveLength(1);
      expect(events[0].data).not.toHaveProperty("unchangedReads");
    });

    it("a warning that lands on a run that skipped the read still suggests the memo", () => {
      const { props, setRow } = rowProps();
      const { events } = capture();
      // Four wasted runs read the unchanged text; the fifth changes the result
      // without reading it, and that run is the one that reaches the threshold.
      const html = createMemo(() => (props.version < 5 ? `<p>${props.text}</p>` : "done"), {
        name: "html"
      });
      observe(html);
      flush();
      for (let i = 1; i <= 5; i++) {
        setRow({ text: "Hello", version: i });
        flush();
      }
      expect(events).toHaveLength(1);
      expect(events[0].data).toMatchObject({ unchangedReads: ["props.text of <Markdown>"] });
      expect(events[0].message).toContain("createMemo(() => props.text)");
    });

    it("runs before the scope first read a prop count against naming it", () => {
      const { props } = rowProps();
      const [tick, setTick] = createSignal(0, { name: "tick" });
      const { events } = capture();
      let run = 0;
      // Re-runs come from `tick`; `props.text` is read only on the last three.
      const status = createMemo(
        () => {
          run++;
          tick();
          if (run >= 4) props.text;
          return "same";
        },
        { name: "status" }
      );
      observe(status);
      flush();
      for (let i = 1; i <= 5; i++) {
        setTick(i);
        flush();
      }
      expect(events).toHaveLength(1);
      expect(events[0].data).not.toHaveProperty("unchangedReads");
    });

    it("a scope with no named reads keeps the generic advice", () => {
      const { setUser } = coarseReader();
      const { events } = capture();
      for (let i = 1; i <= 8; i++) {
        setUser({ name: "Ada", visits: i });
        flush();
      }
      expect(events).toHaveLength(1);
      expect(events[0].data).not.toHaveProperty("unchangedReads");
      expect(events[0].message).not.toContain("got the same value");
    });
  });

  describe("computeds whose value is undefined", () => {
    function run(make: (x: () => number) => () => unknown) {
      const [x, setX] = createSignal(0, { name: "x" });
      let read!: () => unknown;
      createRoot(() => {
        read = make(x);
      });
      flush();
      const { events } = capture();
      for (let i = 1; i <= 10; i++) {
        setX(i);
        flush();
        read();
      }
      return events;
    }

    it("a projection that mutates its draft is not waste", () => {
      const events = run(x => {
        const s = createProjection<{ v: number }>(
          d => {
            d.v = x();
          },
          { v: 0 },
          { name: "draft projection" }
        );
        return () => s.v;
      });
      expect(events).toHaveLength(0);
      // Every consumer reads the same fact: the records and costs() agree.
      const reruns = attribution.history("rerun").filter(e => e.nodeName === "draft projection");
      expect(reruns).toHaveLength(10);
      expect(reruns.every(e => e.changed)).toBe(true);
      const scope = costs().scopes.find(s => s.name === "draft projection");
      expect(scope?.runs).toBe(10);
      expect(scope?.wastedMs).toBe(0);
    });

    it("a projection that returns a value to reconcile is not waste", () => {
      const events = run(x => {
        const s = createProjection(() => ({ v: x() }), { v: 0 }, { name: "returning projection" });
        return () => s.v;
      });
      expect(events).toHaveLength(0);
    });

    it("a memo that returns undefined and does its work by writing is not waste", () => {
      const [y, setY] = createSignal(0, { name: "y", ownedWrite: true });
      const events = run(x => {
        createMemo(
          () => {
            setY(x() * 2);
          },
          { name: "sweep memo" }
        );
        return y;
      });
      expect(y()).toBe(20);
      expect(events).toHaveLength(0);
    });

    it("a memo that keeps returning the same defined value is still waste", () => {
      const events = run(x => createMemo(() => (x(), 7), { name: "constant memo" }));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ nodeName: "constant memo" });
    });
  });
});
