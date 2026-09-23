/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// `@solidjs/web/performance-tracks`: the attribution engine's records and
// the web runtime's `call`/`frame` records, painted as Chrome Performance
// panel tracks (group `Solid`) through the panel's extensibility API.
//
// Claim under test: every span is a retroactive rendering of a record the
// engine already delivered — same start/end as the record's own
// `performance.now()` stamps, same labels as the shared formatters
// (`formatOrigin`, `formatRerun`, `ownerPath`) — so the timeline the human
// reads and the artifact the agent reads cannot disagree. Rich mode
// (`performance.measure` with `detail.devtools`, the dev default) carries
// tooltips and properties; plain mode (`console.timeStamp`, six arguments)
// carries the span alone. Disabling releases the adapter's engine hold and
// nothing more; the prod artifact is a no-op.
//
// Every duration here is exact: the tests run on a clock of their own (see
// `clock`), so a threshold is crossed because a test advanced past it, never
// because the runner was slow.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@solidjs/web";
import {
  OBSERVE,
  Show,
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "solid-js";
import { attribution, formatOrigin, formatRerun, isLongHold } from "solid-js/attribution";
import type { InteractionEvent, RerunEvent, HoldEvent } from "solid-js/attribution";
import type { CallEvent } from "@solidjs/web";
import { enablePerformanceTracks } from "../performance-tracks/src/index.js";

interface Measure {
  label: string;
  start: number;
  end: number;
  track: string;
  group: string;
  color: string;
  tooltip?: string;
  properties?: [string, string][];
}

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  attribution.disable();
  flush();
  vi.restoreAllMocks();
  restorePerformance();
});

// jsdom's `performance` has no User Timing and its console no `timeStamp`;
// install recording stand-ins per test and take them down after.
const originals = (
  [
    [performance, "now"],
    [performance, "measure"],
    [performance, "clearMeasures"],
    [performance, "mark"],
    [performance, "clearMarks"],
    [performance, "getEntriesByName"],
    [console, "timeStamp"],
    [console, "createTask"]
  ] as [object, string][]
).map(([target, name]) => [target, name, Object.getOwnPropertyDescriptor(target, name)] as const);
function restorePerformance() {
  for (const [target, name, original] of originals) {
    if (original) Object.defineProperty(target, name, original);
    else delete (target as any)[name];
  }
}
function define(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
}

/**
 * The engine's clock, in the test's hand. Every number the adapter paints
 * from — a run's `at` and `totalMs`, a drain's `durationMs`, an
 * interaction's `handlerMs` and `settledMs`, a hold's `holdMs` and `tailMs`,
 * a flight's `durationMs`, a fallback's `shownMs` — is a `performance.now()`
 * read in the attribution core (its `now()` reads it on every call), and the
 * adapter's colour thresholds (`< 16` on a wave, `< 10` / `< 100` on a
 * callback, the self-time palette) and the engine's own hold verdicts
 * (`longHolds.infoMs`) are cut against those numbers. On the wall clock a
 * loaded CI runner crossed them at random: a two-run drain read `>= 16ms`
 * and its wave came out `primary-dark` (#3594). Here the clock stands still
 * unless a test advances it — inside a compute, a callback, a handler, or
 * while a flight is in the air — to give that step an exact cost, so every
 * duration is the sum of the advances the test made, and each threshold is
 * exercised on both sides by choice. Real timers are untouched: `setTimeout`
 * still drives the async flights; only the stamps are ours.
 *
 * Starts at 1000: jsdom dates a dispatched event with epoch milliseconds,
 * which the runtime discards as an interaction start when it is ahead of
 * `performance.now()` (as it always is on the real clock too), so no input
 * delay is inferred.
 */
let clock: { now(): number; advance(ms: number): void };
beforeEach(() => {
  let t = 1000;
  define(performance, "now", () => t);
  clock = {
    now: () => t,
    advance(ms) {
      t += ms;
    }
  };
});

/** A marker (`performance.mark` with `detail.devtools`), decoded. */
interface Marker {
  label: string;
  color: string;
  tooltip?: string;
  properties?: [string, string][];
  issue?: { name: string; severity: string; description: string; learnMoreUrl?: string };
  /** The console task the entry was emitted under, if any (see `tasks`). */
  task?: string;
}

/** Rich mode: what `performance.measure` / `performance.mark` were handed, decoded. */
function measures() {
  const seen: (Measure & { task?: string })[] = [];
  const marks: Marker[] = [];
  const cleared: string[] = [];
  // The timeline's live entries by name, as `getEntriesByName` reports them:
  // the adapter clears a name only while it holds no more entries than the
  // adapter made (an app's measure of the same name keeps the name).
  const live = new Map<string, number>();
  const add = (name: string) => live.set(name, (live.get(name) ?? 0) + 1);
  define(performance, "getEntriesByName", (name: string) =>
    Array.from({ length: live.get(name) ?? 0 }, () => ({ name }))
  );
  define(performance, "measure", (label: string, opts: any) => {
    add(label);
    const d = opts.detail.devtools;
    const m: Measure & { task?: string } = {
      label,
      start: opts.start,
      end: opts.end,
      track: d.track,
      group: d.trackGroup,
      color: d.color
    };
    if (d.tooltipText !== undefined) m.tooltip = d.tooltipText;
    if (d.properties !== undefined) m.properties = d.properties;
    if (currentTask !== undefined) m.task = currentTask;
    expect(d.dataType).toBe("track-entry");
    seen.push(m);
  });
  define(performance, "mark", (label: string, opts: any) => {
    add(label);
    const d = opts.detail.devtools;
    expect(d.dataType).toBe("marker");
    const m: Marker = { label, color: d.color };
    if (d.tooltipText !== undefined) m.tooltip = d.tooltipText;
    if (d.properties !== undefined) m.properties = d.properties;
    if (d.performanceIssue !== undefined) m.issue = d.performanceIssue;
    if (currentTask !== undefined) m.task = currentTask;
    marks.push(m);
  });
  define(performance, "clearMeasures", (name: string) => {
    live.delete(name);
    cleared.push(name);
  });
  define(performance, "clearMarks", (name: string) => {
    live.delete(name);
    cleared.push(name);
  });
  return {
    seen,
    marks,
    cleared,
    /** An entry the app made under `name` (not through the adapter). */
    appEntry: add,
    on: (track: string) => seen.filter(m => m.track === track)
  };
}

/** Plain mode: the six-argument `console.timeStamp` calls (and the one-argument marker form). */
function stamps() {
  const seen: Measure[] = [];
  const marks: string[] = [];
  define(console, "timeStamp", (...args: any[]) => {
    if (args.length === 1) {
      marks.push(args[0]);
      return;
    }
    const [label, start, end, track, group, color] = args;
    seen.push({ label, start, end, track, group, color });
  });
  return { seen, marks, on: (track: string) => seen.filter(m => m.track === track) };
}

/**
 * A stand-in for Chrome's `console.createTask`: `run(fn)` marks `fn` as
 * running under the task's name, which the recording `performance.measure`
 * / `performance.mark` above note on the entry. Installed before any
 * component is created: the dev component wrapper creates the task at
 * render time.
 */
let currentTask: string | undefined;
function tasks() {
  const created: string[] = [];
  define(console, "createTask", (name: string) => {
    created.push(name);
    return {
      run<T>(fn: () => T): T {
        const previous = currentTask;
        currentTask = name;
        try {
          return fn();
        } finally {
          currentTask = previous;
        }
      }
    };
  });
  return { created };
}

function quiet() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
}

/** The engine's own delivery of each record, for the span ↔ record join. */
function records() {
  const reruns: RerunEvent[] = [];
  const interactions: InteractionEvent[] = [];
  const holds: HoldEvent[] = [];
  attribution.subscribe("rerun", e => reruns.push(e));
  attribution.subscribe("interaction", e => interactions.push(e));
  attribution.subscribe("hold", e => holds.push(e));
  return { reruns, interactions, holds };
}

function enable(options?: Parameters<typeof enablePerformanceTracks>[0]) {
  quiet();
  const disable = enablePerformanceTracks({
    ...options,
    attribution: { hotRuns: false, hotTime: false, waterfalls: false, ...options?.attribution }
  });
  disposers.push(disable);
  return disable;
}

const TRACK_ORDER = [
  "Interactions",
  "Propagation",
  "Effects",
  "Memos",
  "Async",
  "Holds",
  "Navigations",
  "Server"
];

/** The wave spans on `Propagation`: the drains, not the seed nor the runs inside (`←`, `· create`, `· callback`). */
function waveSpans(spans: Measure[]) {
  return spans.filter(
    m => m.track === "Propagation" && m.label !== "Propagation" && / · \d+ runs?/.test(m.label)
  );
}

/** The re-run spans on an `Effects`/`Memos` track: not the seed, not a creation or a callback. */
function rerunSpans(spans: Measure[], track: "Effects" | "Memos") {
  return spans.filter(
    m => m.track === track && m.label !== track && !/ · (create|callback)$/.test(m.label)
  );
}

describe("enablePerformanceTracks", () => {
  test("seeds the tracks in display order at t=0.003, under the group", () => {
    const { seen } = measures();
    enable();
    expect(seen.map(m => m.track)).toEqual(TRACK_ORDER);
    for (const m of seen) {
      expect(m).toMatchObject({ label: m.track, start: 0.003, end: 0.003, group: "Solid" });
    }
  });

  test("the group name is an option", () => {
    const { seen } = measures();
    enable({ group: "My App" });
    expect(seen.every(m => m.group === "My App")).toBe(true);
  });

  test("click → write → memo → effect: one span per record, on the record's own clock", () => {
    const { on } = measures();
    enable();
    const { reruns, interactions } = records();

    const [n, setN] = createSignal(0, { name: "count" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    // The handler costs 3ms, the memo 5ms a run, the effect nothing.
    const dispose = render(() => {
      const doubled = createMemo(() => (clock.advance(5), n() * 2), { name: "doubled" });
      createEffect(doubled, () => {}, { name: "paint" });
      return (
        <button
          id="next"
          onClick={() => {
            clock.advance(3);
            setN(v => v + 1);
          }}
        >
          Next
        </button>
      );
    }, container);
    disposers.push(dispose, () => container.remove());
    flush();

    const clicked = clock.now();
    container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();

    // The interaction: labelled by the shared formatter, start/end from the
    // record — the handler's 3ms, then the settle through the 5ms drain.
    const [interaction] = interactions;
    expect(interaction).toMatchObject({
      outcome: "committed",
      at: clicked,
      handlerMs: 3,
      settledMs: 8
    });
    expect(interaction.inputDelayMs).toBeUndefined();
    const spans = on("Interactions").filter(m => m.label !== "Interactions");
    expect(spans[0]).toMatchObject({
      label: formatOrigin(interaction.origin),
      start: interaction.at,
      end: interaction.at + interaction.handlerMs,
      color: "primary"
    });
    expect(spans[0].properties).toEqual(
      expect.arrayContaining([
        ["Handler", "3.00ms"],
        ["Writes", "1"],
        ["Re-runs", expect.stringMatching(/^2 \(/)],
        ["Outcome", "committed"]
      ])
    );
    // The settle: from the handler's return to the drain that committed the write.
    expect(spans[1]).toMatchObject({
      label: "committed",
      start: spans[0].end,
      end: interaction.at + interaction.settledMs!,
      color: "secondary-light"
    });
    expect(spans).toHaveLength(2); // no input delay was inferred (see `clock`)

    // The memo and the effect: on their tracks, `at → at + totalMs`, why-chain as tooltip.
    const memo = reruns.find(r => r.nodeName === "doubled")!;
    const effect = reruns.find(r => r.nodeName === "paint")!;
    expect(memo).toMatchObject({ at: clicked + 3, totalMs: 5, selfMs: 5 });
    expect(effect).toMatchObject({ at: clicked + 8, totalMs: 0 });
    const [memoSpan] = rerunSpans(on("Memos"), "Memos");
    const [effectSpan] = rerunSpans(on("Effects"), "Effects");
    expect(memoSpan).toMatchObject({
      start: memo.at,
      end: memo.at + memo.totalMs,
      tooltip: formatRerun(memo)
    });
    expect(memoSpan.label.endsWith("doubled")).toBe(true);
    expect(effectSpan).toMatchObject({
      start: effect.at,
      end: effect.at + effect.totalMs,
      tooltip: formatRerun(effect)
    });
    expect(effectSpan.label.endsWith("paint")).toBe(true);
    // The properties carry the cause chain's root and the interaction.
    expect(memoSpan.properties).toEqual(
      expect.arrayContaining([
        ["Changed", "yes"],
        ["Causes", expect.stringContaining('signal "count" write 0 → 1')],
        ["Interaction", formatOrigin(interaction.origin)]
      ])
    );
  });

  test("an unchanged run is painted as waste; cost colours follow self time", () => {
    const { on } = measures();
    enable();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => {
      const constant = createMemo(
        () => {
          n();
          return 1;
        },
        { name: "constant" }
      );
      createRenderEffect(constant, () => {}, { name: "reader" });
    });
    flush();
    setN(1);
    flush();
    const [span] = rerunSpans(on("Memos"), "Memos");
    expect(span.color).toBe("warning");
    expect(span.properties).toEqual(
      expect.arrayContaining([["Changed", "no — unchanged (wasted)"]])
    );
  });

  test("cost colours: the self-time palette, on both sides of each of its cuts", () => {
    const { on } = measures();
    enable();
    const [n, setN] = createSignal(0, { name: "n" });
    let cost = 0;
    createRoot(() => {
      const work = createMemo(() => (clock.advance(cost), n()), { name: "work" });
      createRenderEffect(work, () => {}, { name: "reader" });
    });
    flush();
    // `bySelfTime`: `< 0.5` light, `< 10` primary, `< 100` dark, else error.
    const costs = [0.25, 0.5, 9, 10, 99, 100];
    for (const ms of costs) {
      cost = ms;
      setN(v => v + 1);
      flush();
    }
    const spans = rerunSpans(on("Memos"), "Memos");
    expect(spans.map(m => [m.end - m.start, m.color])).toEqual([
      [0.25, "primary-light"],
      [0.5, "primary"],
      [9, "primary"],
      [10, "primary-dark"],
      [99, "primary-dark"],
      [100, "error"]
    ]);
    for (const [i, m] of spans.entries()) {
      expect(m.properties).toEqual(
        expect.arrayContaining([["Self time", `${costs[i].toFixed(2)}ms`]])
      );
    }
  });

  test("a run under the minMs floor is not painted", () => {
    const { on } = measures();
    enable({ minMs: 1000 });
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();
    setN(1);
    flush();
    expect(on("Effects").filter(m => m.label !== "Effects")).toEqual([]);
  });

  test("the mount flame: creation runs and effect callbacks are spans of their own, the drain a Propagation wave", () => {
    const { on } = measures();
    enable();
    const { reruns: runs } = records();
    const [n, setN] = createSignal(0, { name: "count" });
    // The memo costs 2ms a run; the effect's compute and callback nothing.
    const mounted = clock.now();
    createRoot(() => {
      const doubled = createMemo(() => (clock.advance(2), n() * 2), { name: "doubled" });
      createRenderEffect(doubled, () => {}, { name: "paint" });
    });
    flush();
    // Creation: one span per node born, on its kind's track, labelled `· create`.
    const memoCreate = on("Memos").find(m => m.label.endsWith("doubled · create"))!;
    const effectCreate = on("Effects").find(m => m.label.endsWith("paint · create"))!;
    expect(memoCreate).toMatchObject({ start: mounted, end: mounted + 2, color: "primary" });
    expect(effectCreate).toMatchObject({ start: mounted + 2, end: mounted + 2 });
    expect(memoCreate.properties).toEqual(
      expect.arrayContaining([
        ["Self time", "2.00ms"],
        ["Deps", "1"],
        ["Phase", "plain"]
      ])
    );
    // The first callback: after its compute, no run to join to.
    const firstCallback = on("Effects").find(m => m.label.endsWith("paint · callback"))!;
    expect(firstCallback).toMatchObject({ start: effectCreate.end, end: effectCreate.end });
    expect(firstCallback.properties!.some(([k]) => k === "Run")).toBe(false);

    const clicked = clock.now();
    OBSERVE!.attribution.withInteraction({ type: "click", target: 'button#next "Next →"' }, () =>
      setN(1)
    );
    flush();
    // The re-run's callback joins its compute run by number and follows it in time.
    const rerun = runs.find(r => r.nodeName === "paint")!;
    expect(rerun).toMatchObject({ at: clicked + 2, totalMs: 0 });
    const callbacks = on("Effects").filter(m => m.label.endsWith("paint · callback"));
    expect(callbacks).toHaveLength(2);
    expect(callbacks[1].properties).toEqual(
      expect.arrayContaining([
        ["Run", String(rerun.run)],
        ["Interaction", formatOrigin(rerun.interaction!)]
      ])
    );
    expect(callbacks[1]).toMatchObject({
      start: rerun.at + rerun.totalMs,
      end: rerun.at + rerun.totalMs,
      color: "secondary-light" // 0ms: under the callback palette's 10ms cut
    });
    // The wave that served the click: named by the write and the click,
    // two re-runs, nothing created, not held; 2ms — the memo — so under the
    // 16ms cut, `primary`. (The mount itself ran synchronously under
    // createRoot — no drain, so no wave.)
    const waves = waveSpans(on("Propagation"));
    expect(waves).toHaveLength(1);
    const [wave] = waves;
    expect(wave).toMatchObject({
      label: `count 0 → 1 — ${formatOrigin(rerun.interaction!)} · 2 runs`,
      start: clicked,
      end: clicked + 2,
      color: "primary"
    });
    expect(wave.end).toBe(callbacks[1].end);
    expect(wave.properties).toEqual(
      expect.arrayContaining([
        ["Duration", "2.00ms"],
        ["Writes", "count 0 → 1"],
        ["Re-runs", "2"],
        ["Unchanged", "0 (wasted)"],
        ["Created", "0"],
        ["Held", "no"],
        ["Interaction", formatOrigin(rerun.interaction!)]
      ])
    );
  });

  test("Propagation: a wave's colour follows the drain's duration — under 16ms primary, from 16ms primary-dark", () => {
    const { on } = measures();
    enable();
    const [n, setN] = createSignal(0, { name: "n" });
    let cost = 0;
    createRoot(() => createRenderEffect(n, () => clock.advance(cost), { name: "reader" }));
    flush();
    // One drain per write, each exactly as long as its callback.
    for (const ms of [0, 15, 16, 40]) {
      cost = ms;
      setN(v => v + 1);
      flush();
    }
    const waves = waveSpans(on("Propagation"));
    expect(waves.map(w => [w.end - w.start, w.color])).toEqual([
      [0, "primary"],
      [15, "primary"],
      [16, "primary-dark"],
      [40, "primary-dark"]
    ]);
    expect(waves.map(w => w.properties!.find(([k]) => k === "Duration")![1])).toEqual([
      "0.00ms",
      "15.00ms",
      "16.00ms",
      "40.00ms"
    ]);
  });

  test("Effects: a callback's colour follows its duration — under 10ms light, under 100ms secondary, from 100ms error", () => {
    const { on } = measures();
    enable();
    const [n, setN] = createSignal(0, { name: "n" });
    let cost = 0;
    createRoot(() => createRenderEffect(n, () => clock.advance(cost), { name: "reader" }));
    flush();
    for (const ms of [9, 10, 99, 100]) {
      cost = ms;
      setN(v => v + 1);
      flush();
    }
    const callbacks = on("Effects").filter(m => m.label.endsWith("reader · callback"));
    expect(callbacks.map(m => [m.end - m.start, m.color])).toEqual([
      [0, "secondary-light"], // the mount
      [9, "secondary-light"],
      [10, "secondary"],
      [99, "secondary"],
      [100, "error"]
    ]);
  });

  test("Propagation: the runs inside a wave are labelled by what made them run, callbacks as the leaves", () => {
    const { on } = measures();
    enable();
    const { reruns } = records();
    const [n, setN] = createSignal(0, { name: "count" });
    createRoot(() => {
      const doubled = createMemo(() => n() * 2, { name: "doubled" });
      const label = createMemo(() => `${doubled()}!`, { name: "label" });
      createRenderEffect(
        () => [doubled(), label()],
        () => {},
        { name: "paint" }
      );
    });
    flush();
    setN(1);
    flush();

    const spans = on("Propagation").filter(m => m.label !== "Propagation");
    const wave = waveSpans(spans).at(-1)!;
    const inside = spans.filter(m => m !== wave && m.start >= wave.start && m.end <= wave.end);
    // Each run: the same span as on Effects/Memos (start, end, colour,
    // tooltip), with `← cause` on the label; both causes named, once each.
    const memo = reruns.find(r => r.nodeName === "doubled")!;
    const doubledSpan = inside.find(m => m.label.endsWith("doubled ← count"))!;
    expect(doubledSpan).toMatchObject({
      start: memo.at,
      end: memo.at + memo.totalMs,
      tooltip: formatRerun(memo)
    });
    expect(inside.some(m => m.label.endsWith("label ← doubled"))).toBe(true);
    expect(inside.some(m => m.label.endsWith("paint ← doubled, label"))).toBe(true);
    expect(inside.some(m => m.label.endsWith("paint · callback"))).toBe(true);
    // Mirrored on the per-kind tracks with the plain owner-path label.
    expect(rerunSpans(on("Memos"), "Memos").map(m => m.label.split(" › ").at(-1))).toEqual([
      "doubled",
      "label"
    ]);
    // The wave names its root write and what it reached.
    expect(wave.label).toBe("count 0 → 1 · 3 runs");
  });

  test("Propagation: a wave that mostly re-ran unchanged nodes is a warning, and says so", () => {
    const { on } = measures();
    enable();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => {
      const a = createMemo(() => (n(), 1), { name: "a" });
      const b = createMemo(() => (n(), 2), { name: "b" });
      createRenderEffect(
        () => [a(), b()],
        () => {},
        { name: "reader" }
      );
    });
    flush();
    setN(1);
    flush();
    const wave = waveSpans(on("Propagation")).at(-1)!;
    // Two memos re-ran to the same value; the cutoff kept the effect out.
    expect(wave).toMatchObject({ label: "n 0 → 1 · 2 runs, 2 unchanged", color: "warning" });
  });

  test("Propagation: the wave survives the minMs floor and carries the counts the hidden runs would have shown", () => {
    const { on } = measures();
    enable({ minMs: 1000 });
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => {
      for (let i = 0; i < 5; i++) createRenderEffect(n, () => {}, { name: `reader${i}` });
    });
    flush();
    setN(1);
    flush();
    const spans = on("Propagation").filter(m => m.label !== "Propagation");
    expect(spans.filter(m => / ← /.test(m.label))).toEqual([]);
    expect(waveSpans(spans).at(-1)!.label).toBe("n 0 → 1 · 5 runs");
  });

  test("a flow control's own nodes fold into its tag on the label; the runtime's name is a property", () => {
    const { on } = measures();
    enable();
    const [flag, setFlag] = createSignal(false, { name: "flag" });
    const [n, setN] = createSignal(0, { name: "n" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const Card = () => (
      <Show when={flag()}>
        <span>{n()}</span>
      </Show>
    );
    const dispose = render(() => <Card />, container);
    disposers.push(dispose, () => container.remove());
    flush();
    setFlag(true);
    flush();
    setN(1);
    flush();

    const memos = rerunSpans(on("Memos"), "Memos");
    // `<Show>`'s `condition value` → `condition` → `value` chain: three memo
    // re-runs, each labelled as the Show itself, none by its internal name.
    expect(memos).toHaveLength(3);
    for (const m of memos) {
      expect(m.label.endsWith("<Card> › <Show>")).toBe(true);
      expect(m.label).not.toMatch(/condition|value/);
    }
    expect(memos.map(m => m.properties!.find(([k]) => k === "Node")![1])).toEqual([
      "condition value",
      "condition",
      "value"
    ]);
    // The user's binding under the Show: owned by `value` in the runtime,
    // shown under `<Show>`. (The other effect re-run is render's own
    // insert at the root, re-placing the Show's output — no owner path.)
    const effects = rerunSpans(on("Effects"), "Effects");
    expect(effects.map(m => m.label)).toEqual(["effect", "<Card> › <Show> › effect"]);
    // On Propagation every cause reads as the Show, never as `value`.
    const propagation = on("Propagation").filter(m => / ← /.test(m.label));
    expect(propagation.map(m => m.label)).toEqual([
      "<Card> › <Show> ← flag",
      "<Card> › <Show> ← <Show>",
      "<Card> › <Show> ← <Show>",
      "effect ← <Show>",
      "<Card> › <Show> › effect ← n"
    ]);
  });

  test("a composed primitive's nodes (`primitive.local`) fold into the primitive", () => {
    const { on } = measures();
    enable();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => {
      const value = createMemo(() => n() * 2, { name: "createDebounced.value" });
      createRenderEffect(value, () => {}, { name: "reader" });
    });
    flush();
    setN(1);
    flush();
    const [memo] = rerunSpans(on("Memos"), "Memos");
    expect(memo.label).toBe("createDebounced");
    expect(memo.properties).toEqual(expect.arrayContaining([["Node", "value"]]));
    const labels = on("Propagation")
      .filter(m => / ← /.test(m.label))
      .map(m => m.label);
    expect(labels).toEqual(["createDebounced ← n", "reader ← createDebounced"]);
  });

  test("Async: a flight from origin to landing, an abandoned one as a warning, a fallback show → hide", async () => {
    const { on } = measures();
    enable();
    const [page, setPage] = createSignal(1, { name: "page" });
    let resolve!: (v: string) => void;
    const shown: string[] = [];
    createRoot(() => {
      const posts = createMemo(
        () => {
          const p = page();
          return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
        },
        { name: "posts" }
      );
      const view = createLoadingBoundary(
        () => posts(),
        () => "loading…"
      );
      createRenderEffect(
        view,
        v => {
          shown.push(String(v));
        },
        { name: "view" }
      );
    });
    flush();
    expect(shown).toEqual(["loading…"]);
    const took = clock.now(); // the flight's origin and the fallback's appearance, both at mount
    // 10ms in the air, on the engine's clock, before the answer.
    clock.advance(10);
    resolve("a");
    await until(() => shown.includes("a-p1"));
    const spans = on("Async").filter(m => m.label !== "Async");
    const landed = spans.find(m => m.label === "posts")!;
    const fallback = spans.find(m => m.label.startsWith("fallback"))!;
    expect(landed).toMatchObject({ start: took, end: took + 10, color: "secondary" });
    expect(landed.properties).toEqual(
      expect.arrayContaining([
        ["In the air", "10.00ms"],
        ["Outcome", "landed"]
      ])
    );
    expect(fallback).toMatchObject({ start: took, end: took + 10, color: "tertiary" });
    expect(fallback.properties![0]).toEqual(["Shown", "10.00ms"]);

    // Two re-asks before an answer: the first flight is thrown away.
    setPage(2);
    flush();
    setPage(3);
    flush();
    const abandoned = on("Async").find(m => m.label === "posts · abandoned")!;
    expect(abandoned).toMatchObject({ color: "warning" });
    expect(abandoned.properties).toEqual(expect.arrayContaining([["Outcome", "abandoned"]]));
    resolve("c");
    await until(() => shown.includes("c-p3"));
  });

  test("a hold: the wait on the Holds track, the engine's silent-hold verdict as its colour, the interaction's settle as held", async () => {
    const { on } = measures();
    enable({ attribution: { holds: { infoMs: 0, warnMs: 0 } } });
    const { interactions, holds } = records();

    const [page, setPage] = createSignal(1, { name: "page" });
    let resolve!: (v: string) => void;
    const shown: string[] = [];
    createRoot(() => {
      const posts = createMemo(
        () => {
          const p = page();
          return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
        },
        { name: "posts" }
      );
      createRenderEffect(
        posts,
        v => {
          shown.push(String(v));
        },
        { name: "feed" }
      );
    });
    flush();
    resolve("a");
    await until(() => shown.includes("a-p1"));

    const clicked = clock.now();
    OBSERVE!.attribution.withInteraction({ type: "click", target: 'button#next "Next →"' }, () =>
      setPage(2)
    );
    flush();
    // 10ms held, on the engine's clock, before the answer commits it.
    clock.advance(10);
    resolve("b");
    await until(() => shown.includes("b-p2"));

    const [hold] = holds;
    const [interaction] = interactions;
    expect(interaction).toMatchObject({
      outcome: "held",
      at: clicked,
      handlerMs: 0,
      settledMs: 10
    });
    expect(hold).toMatchObject({ at: clicked, holdMs: 10, tailMs: 10 });
    expect(isLongHold(hold)).toBe(false); // 10ms tail: under `longHolds.infoMs`
    const [holdSpan] = on("Holds").filter(m => m.label !== "Holds");
    expect(holdSpan).toMatchObject({
      label: "waiting on posts",
      start: hold.at,
      end: hold.at + hold.holdMs,
      color: "warning" // silent: nothing acknowledged the wait
    });
    expect(holdSpan.properties).toEqual(
      expect.arrayContaining([
        ["Held", "10.00ms"],
        ["Held writes", "page 1 → 2"], // dev: previews shown (see the scrub test)
        ["Acknowledged by", "nothing"],
        ["Verdict", "silent hold — no feedback while waiting"],
        ["Interaction", formatOrigin(interaction.origin)]
      ])
    );
    expect(holdSpan.properties!.some(([k, v]) => k === "Verdict" && v === "long hold")).toBe(false);
    const settle = on("Interactions").find(m => m.label === "held")!;
    expect(settle).toMatchObject({
      start: clicked,
      end: interaction.at + interaction.settledMs!,
      color: "warning"
    });
  });

  test("a hold: the engine's long-hold verdict is the colour, on both sides of its threshold", async () => {
    const { on } = measures();
    enable({
      attribution: { holds: { infoMs: 0, warnMs: 0 }, longHolds: { infoMs: 500, warnMs: 1000 } }
    });
    const { holds } = records();

    const [page, setPage] = createSignal(1, { name: "page" });
    let resolve!: (v: string) => void;
    const shown: string[] = [];
    createRoot(() => {
      const posts = createMemo(
        () => {
          const p = page();
          return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
        },
        { name: "posts" }
      );
      createRenderEffect(
        posts,
        v => {
          shown.push(String(v));
        },
        { name: "feed" }
      );
    });
    flush();
    resolve("a");
    await until(() => shown.includes("a-p1"));

    // Two holds, each silent (nothing acknowledges the wait): one a hair
    // under the long-hold threshold, one exactly on it.
    setPage(2);
    flush();
    clock.advance(499);
    resolve("b");
    await until(() => shown.includes("b-p2"));
    setPage(3);
    flush();
    clock.advance(500);
    resolve("c");
    await until(() => shown.includes("c-p3"));

    expect(holds.map(h => [h.holdMs, h.tailMs, isLongHold(h)])).toEqual([
      [499, 499, false],
      [500, 500, true]
    ]);
    const spans = on("Holds").filter(m => m.label !== "Holds");
    expect(spans.map(m => [m.end - m.start, m.color])).toEqual([
      [499, "warning"], // silent, not long
      [500, "error"] // long: the verdict outranks silent
    ]);
    const verdicts = (m: Measure) =>
      m.properties!.filter(([k]) => k === "Verdict").map(([, v]) => v);
    expect(verdicts(spans[0])).toEqual(["silent hold — no feedback while waiting"]);
    expect(verdicts(spans[1])).toEqual(["silent hold — no feedback while waiting", "long hold"]);
  });

  test("a navigation: request → settle on the Navigations track, named by route", () => {
    const { on } = measures();
    enable();
    const [location, setLocation] = createSignal("/users", { name: "location" });
    // The router's callback costs 4ms: the navigation settles 4ms after its request.
    createRoot(() => createRenderEffect(location, () => clock.advance(4), { name: "router" }));
    flush();
    const requested = clock.now();
    OBSERVE!.attribution.withOrigin(
      {
        kind: "navigation",
        name: "/users/:id",
        to: "/users/42",
        from: "/users",
        params: { id: "42" }
      },
      () => setLocation("/users/42")
    );
    flush();
    const [span] = on("Navigations").filter(m => m.label !== "Navigations");
    expect(span).toMatchObject({
      label: "navigation to /users/:id (/users/42)",
      start: requested,
      end: requested + 4,
      color: "secondary"
    });
    expect(span.properties).toEqual(
      expect.arrayContaining([
        ["Settled", "4.00ms"],
        ["To", "/users/42"],
        ["From", "/users"],
        ["Params", "id=42"],
        ["Outcome", "committed"]
      ])
    );
  });

  test("a server-function call record lands on the Server track", () => {
    const { on } = measures();
    enable();
    const event: CallEvent = {
      id: "api/save",
      at: performance.now() - 50,
      durationMs: 43,
      method: "POST",
      outcome: "ok",
      status: 200
    };
    OBSERVE!.records.emit("call", event, { args: [] });
    const failed: CallEvent = { ...event, id: "api/fail", outcome: "error", status: 500 };
    OBSERVE!.records.emit("call", failed, { args: [], error: new Error("boom") });

    const spans = on("Server").filter(m => m.label !== "Server");
    expect(spans[0]).toMatchObject({
      label: "POST api/save · 200",
      start: event.at,
      end: event.at + 43,
      color: "secondary"
    });
    expect(spans[0].properties).toEqual(
      expect.arrayContaining([
        ["Duration", "43.00ms"],
        ["Status", "200"]
      ])
    );
    expect(spans[1]).toMatchObject({ label: "POST api/fail · 500", color: "error" });
  });

  test("a frame applied on the client: the stream and its time-to-shell", () => {
    const { on } = measures();
    enable();
    const at = performance.now() - 100;
    OBSERVE!.records.emit(
      "frame",
      {
        side: "client",
        id: "hn/list",
        version: 2,
        at,
        durationMs: 80,
        shellMs: 12,
        outcome: "complete",
        chunks: 5,
        fragments: 2,
        slots: 0,
        regions: 0,
        errors: 0
      },
      {}
    );
    const spans = on("Server").filter(m => m.label !== "Server");
    expect(spans).toEqual([
      expect.objectContaining({
        label: "frame hn/list · shell",
        start: at,
        end: at + 12,
        color: "secondary-light"
      }),
      expect.objectContaining({
        label: "frame hn/list",
        start: at,
        end: at + 80,
        color: "secondary"
      })
    ]);
  });

  test("plain mode: console.timeStamp with the six-argument form, no properties", () => {
    const { seen, on } = stamps();
    enable({ rich: false });
    expect(seen.map(m => m.track)).toEqual(TRACK_ORDER);
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();
    setN(1);
    flush();
    const [span] = rerunSpans(on("Effects"), "Effects");
    expect(span.group).toBe("Solid");
    expect(span.label.endsWith("reader")).toBe(true);
    expect(span.properties).toBeUndefined();
  });

  test("rich mode clears the User Timing entries it made", () => {
    const { seen, cleared } = measures();
    const disable = enable();
    disable();
    // Every label the adapter measured is released by name — the trace
    // already has them; the performance timeline does not keep them.
    expect(new Set(cleared)).toEqual(new Set(seen.map(m => m.label)));
  });

  test("rich mode leaves an app measure that shares a label alone", () => {
    const { seen, cleared, appEntry } = measures();
    const disable = enable();
    // The app measured under one of the adapter's labels (a track name here).
    appEntry("Memos");
    disable();
    expect(cleared).not.toContain("Memos");
    expect(new Set(cleared)).toEqual(new Set(seen.map(m => m.label).filter(l => l !== "Memos")));
  });

  test("a host API that throws drops the entry and never reaches the engine", () => {
    const { seen } = measures();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const measure = performance.measure;
    define(performance, "measure", (label: string, opts: any) => {
      if (label.endsWith("reader")) throw new TypeError("refused");
      return measure(label, opts);
    });
    enable();
    const { reruns } = records();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();
    setN(1);
    flush();
    // The engine delivered the record to every listener; the span was dropped.
    expect(reruns).toHaveLength(1);
    expect(seen.some(m => m.label.endsWith("reader"))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("performance-tracks");
    setN(2);
    flush();
    expect(reruns).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1); // once
  });

  test("one instance per page: a second enable joins it, and the last release tears it down", () => {
    const { seen } = measures();
    const first = enable();
    const second = enable({ group: "Other" });
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();
    setN(1);
    flush();
    // Painted once, in the first call's group — not twice.
    const painted = seen.filter(m => m.label.endsWith("reader"));
    expect(painted).toHaveLength(1);
    expect(painted[0].group).toBe("Solid");
    first();
    setN(2);
    flush();
    // The second holder keeps the instance alive.
    expect(seen.filter(m => m.label.endsWith("reader"))).toHaveLength(2);
    second();
    setN(3);
    flush();
    expect(seen.filter(m => m.label.endsWith("reader"))).toHaveLength(2);
    // The engine hold was taken once and is released with the instance.
    expect(attribution.history()).toEqual([]);
  });

  test("scrub: no value previews, no element text except on a button or a link", () => {
    const { on } = measures();
    enable({ scrub: true });
    const { interactions } = records();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();

    OBSERVE!.attribution.withInteraction(
      { type: "click", target: 'div#card "Personal note about a person"' },
      () => setN(1)
    );
    flush();
    OBSERVE!.attribution.withInteraction({ type: "click", target: 'button#save "Save"' }, () =>
      setN(2)
    );
    flush();

    const labels = on("Interactions").map(m => m.label);
    expect(labels).toContain("click on div#card");
    expect(labels).toContain('click on button#save "Save"');
    expect(labels.some(l => l.includes("Personal note"))).toBe(false);
    // The formatter itself, unscrubbed, would have said more:
    expect(formatOrigin(interactions[0].origin)).toContain("Personal note");

    const [span] = rerunSpans(on("Effects"), "Effects");
    expect(span.tooltip).not.toContain("0 → 1");
    expect(span.tooltip).toContain('signal "n" write');
    expect(span.properties).toEqual(
      expect.arrayContaining([["Causes", expect.not.stringContaining("→")]])
    );
  });

  test("disable releases the adapter's hold and its listeners, and no others", () => {
    const { seen } = measures();
    // Another consumer is already on the engine.
    quiet();
    attribution.enable({ log: false, hotRuns: false, hotTime: false });
    const other: RerunEvent[] = [];
    attribution.subscribe("rerun", e => other.push(e));

    const disable = enable();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();
    setN(1);
    flush();
    const painted = seen.length;
    expect(painted).toBeGreaterThan(TRACK_ORDER.length);
    expect(other).toHaveLength(1);

    disable();
    disable(); // idempotent
    setN(2);
    flush();
    expect(seen).toHaveLength(painted); // nothing more painted
    expect(other).toHaveLength(2); // the other consumer still hears
    attribution.disable();
  });

  test("the adapter asks for no log: quiet alone, and a console session beside it keeps its log", () => {
    measures();
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();

    // The adapter installs the engine: no console log — the timeline is the output.
    const alone = enable();
    setN(1);
    flush();
    expect(logged).not.toHaveBeenCalled();
    alone();

    // A console session holds the engine with the log on; the tracks enabled
    // beside it (in either order) cannot take it away — the engine does what
    // any holder asks for.
    const releaseConsole = attribution.enable({ hotRuns: false, hotTime: false, wideDeps: false });
    const joined = enable();
    setN(2);
    flush();
    expect(logged).toHaveBeenCalledTimes(1);
    releaseConsole();
    setN(3);
    flush();
    expect(logged).toHaveBeenCalledTimes(1); // the session left: quiet again
    joined();
  });

  test("alone on the engine, disable uninstalls it", () => {
    measures();
    const disable = enable();
    disable();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();
    setN(1);
    flush();
    expect(attribution.history()).toEqual([]);
  });

  test("a finding is a marker on the Timings track, an issue for the Insights sidebar when it warns", () => {
    const { marks } = measures();
    enable();
    quiet();
    OBSERVE!.diagnostics.emit({
      code: "SILENT_HOLD",
      kind: "responsiveness",
      severity: "warn",
      message: 'click on button#save "Save" waited 412ms with no feedback',
      ownerPath: ["<App>", "<Search>"],
      nodeName: "results",
      data: { holdMs: 412, interaction: { type: "click" } }
    });
    OBSERVE!.diagnostics.emit({
      code: "HOT_SCOPE_RERUNS",
      kind: "perf",
      severity: "info",
      message: "effect re-ran 130 times in 1s"
    });
    expect(marks).toHaveLength(2);
    const [hold, hot] = marks;
    expect(hold).toMatchObject({
      label: "SILENT_HOLD — <App> › <Search>",
      color: "warning",
      tooltip: 'click on button#save "Save" waited 412ms with no feedback'
    });
    expect(hold.properties).toEqual(
      expect.arrayContaining([
        ["Code", "SILENT_HOLD"],
        ["Kind", "responsiveness"],
        ["Severity", "warn"],
        ["Owner path", "<App> › <Search>"],
        ["Node", "results"],
        ["Message", 'click on button#save "Save" waited 412ms with no feedback'],
        ["holdMs", "412"], // primitive `data` fields ride along; objects do not
        ["Guide", expect.stringMatching(/SKILL\.md#silent_hold$/)]
      ])
    );
    expect(hold.properties!.some(([k]) => k === "interaction")).toBe(false);
    expect(hold.issue).toEqual({
      name: "Solid: SILENT_HOLD",
      severity: "warning",
      description: 'click on button#save "Save" waited 412ms with no feedback',
      learnMoreUrl: expect.stringMatching(/SKILL\.md#silent_hold$/)
    });
    // `info` is a marker and nothing more.
    expect(hot).toMatchObject({ label: "HOT_SCOPE_RERUNS", color: "primary-light" });
    expect(hot.issue).toBeUndefined();
  });

  test("scrub: a finding's marker carries its code, kind and owner, not its sentence", () => {
    const { marks } = measures();
    enable({ scrub: true });
    quiet();
    OBSERVE!.diagnostics.emit({
      code: "LONG_HOLD",
      kind: "responsiveness",
      severity: "error",
      message: 'click on div#card "Personal note" waited 1200ms',
      ownerPath: ["<App>"],
      data: { holdMs: 1200 }
    });
    const [mark] = marks;
    expect(mark).toMatchObject({
      label: "LONG_HOLD — <App>",
      color: "error",
      tooltip: "responsiveness finding LONG_HOLD"
    });
    expect(JSON.stringify(mark)).not.toContain("Personal note");
    expect(mark.properties!.some(([k]) => k === "Message" || k === "holdMs")).toBe(false);
    expect(mark.issue).toMatchObject({
      severity: "error",
      description: "responsiveness finding LONG_HOLD"
    });
  });

  test("plain mode: a finding is the one-argument console.timeStamp — a Timings marker, now", () => {
    const { marks } = stamps();
    enable({ rich: false });
    quiet();
    OBSERVE!.diagnostics.emit({
      code: "SILENT_HOLD",
      kind: "responsiveness",
      severity: "warn",
      message: "waited",
      ownerPath: ["<App>"]
    });
    expect(marks).toEqual(["SILENT_HOLD — <App>"]);
  });

  test("dev: a component's spans are emitted under its console task, so their stack is the JSX site", () => {
    const { created } = tasks();
    const { on, marks } = measures();
    enable();
    const [n, setN] = createSignal(0, { name: "n" });
    function Row() {
      createRenderEffect(n, () => {}, { name: "reader" });
      return <span>{n()}</span>;
    }
    function App() {
      return <Row />;
    }
    const container = document.createElement("div");
    const dispose = render(() => <App />, container);
    disposers.push(dispose);
    flush();
    setN(1);
    flush();
    // One task per component, named as the owner is.
    expect(created).toEqual(["<App>", "<Row>"]);
    // The run inside <Row> was measured under <Row>'s task — the nearest
    // component above it — on both tracks it is painted on.
    const readerSpans = on("Effects").filter(m => m.label.endsWith("reader"));
    expect(readerSpans.length).toBeGreaterThan(0);
    for (const span of readerSpans) expect(span.task).toBe("<Row>");
    expect(
      on("Propagation")
        .filter(m => m.label.includes("reader"))
        .every(m => m.task === "<Row>")
    ).toBe(true);
    // A finding about a node under the component too.
    quiet();
    const subject = OBSERVE!.subjectOf(attribution.history().find(r => r.nodeName === "reader")!)!;
    OBSERVE!.diagnostics.emit(
      { code: "HOT_SCOPE_RERUNS", kind: "perf", severity: "warn", message: "hot" },
      subject
    );
    expect(marks.at(-1)).toMatchObject({
      label: "HOT_SCOPE_RERUNS — <App> › <Row> › reader",
      task: "<Row>"
    });
    // Nothing outside a component carries a task.
    expect(on("Interactions")[0].task).toBeUndefined();
  });

  test("rich mode: every node span names its runtime owner path and node id beside the folded label", () => {
    const { on } = measures();
    enable();
    const [show, setShow] = createSignal(false, { name: "show" });
    const container = document.createElement("div");
    const dispose = render(
      () => (
        <Show when={show()}>
          <span>on</span>
        </Show>
      ),
      container
    );
    disposers.push(dispose);
    flush();
    setShow(true);
    flush();
    const folded = rerunSpans(on("Memos"), "Memos").find(m =>
      m.properties?.some(([k]) => k === "Node")
    )!;
    expect(folded).toBeDefined();
    expect(folded.label.endsWith("<Show>")).toBe(true);
    const props = Object.fromEntries(folded.properties!);
    // The label folded the flow control's node; the properties keep the truth.
    expect(props["Owner path"]).toMatch(/<Show> › /);
    expect(props["Owner path"].endsWith(props.Node)).toBe(true);
    expect(props["Node id"]).toMatch(/^\d+$/);
  });

  test("without console.timeStamp or performance.measure it does nothing", () => {
    // Shadow rather than delete: either may be inherited from a prototype.
    define(performance, "measure", undefined);
    define(console, "timeStamp", undefined);
    const disable = enablePerformanceTracks();
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();
    setN(1);
    flush();
    expect(attribution.history()).toEqual([]); // the engine was never enabled
    disable();
  });
});

describe("the production artifact", () => {
  test("enablePerformanceTracks is a no-op that touches neither the console nor the engine", async () => {
    // Relative import on purpose: the built prod artifact itself is under
    // test (requires a prior build, like the server dist specs).
    // @ts-ignore — no adjacent declarations for the dist file.
    const prod = await import("../performance-tracks/dist/performance-tracks.js");
    const { seen: stamped } = stamps();
    const { seen } = measures();
    const disable = prod.enablePerformanceTracks();
    expect(typeof disable).toBe("function");
    expect(seen).toEqual([]);
    expect(stamped).toEqual([]);
    const [n, setN] = createSignal(0, { name: "n" });
    createRoot(() => createRenderEffect(n, () => {}, { name: "reader" }));
    flush();
    setN(1);
    flush();
    expect(attribution.history()).toEqual([]);
    disable();
  });

  test("the server conditions resolve to it under every posture: the tracks are a browser view", async () => {
    // @ts-ignore — JSON import of the manifest under test.
    const pkg = (await import("../package.json")).default as {
      exports: Record<string, Record<string, unknown>>;
    };
    const entry = pkg.exports["./performance-tracks"];
    const inert = "./performance-tracks/dist/performance-tracks.js";
    for (const runtime of ["node", "worker", "deno"]) {
      const condition = entry[runtime] as Record<string, unknown>;
      expect(condition.default).toBe(inert);
      expect(condition.development).toBeUndefined();
      expect(condition.observe).toBeUndefined();
    }
    const browser = entry.browser as Record<string, Record<string, string>>;
    expect(browser.development.default).toBe("./performance-tracks/dist/performance-tracks.dev.js");
    expect(browser.observe.default).toBe("./performance-tracks/dist/performance-tracks.observe.js");
  });
});

async function until(cond: () => boolean, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    flush();
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error("timed out");
    await new Promise(r => setTimeout(r, 5));
  }
}
