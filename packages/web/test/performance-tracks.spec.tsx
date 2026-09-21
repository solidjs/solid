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
import { afterEach, describe, expect, test, vi } from "vitest";
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
import { attribution, formatOrigin, formatRerun } from "solid-js/attribution";
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
const originals = [
  [performance, "measure"],
  [performance, "clearMeasures"],
  [performance, "mark"],
  [performance, "clearMarks"],
  [console, "timeStamp"],
  [console, "createTask"]
].map(([target, name]) => [target, name, Object.getOwnPropertyDescriptor(target, name)] as const);
function restorePerformance() {
  for (const [target, name, original] of originals) {
    if (original) Object.defineProperty(target, name, original);
    else delete (target as any)[name];
  }
}
function define(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
}

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
  define(performance, "measure", (label: string, opts: any) => {
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
    cleared.push(name);
  });
  define(performance, "clearMarks", (name: string) => {
    cleared.push(name);
  });
  return { seen, marks, cleared, on: (track: string) => seen.filter(m => m.track === track) };
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
    const dispose = render(() => {
      const doubled = createMemo(() => n() * 2, { name: "doubled" });
      createEffect(doubled, () => {}, { name: "paint" });
      return (
        <button id="next" onClick={() => setN(v => v + 1)}>
          Next
        </button>
      );
    }, container);
    disposers.push(dispose, () => container.remove());
    flush();

    container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();

    // The interaction: labelled by the shared formatter, start/end from the record.
    const [interaction] = interactions;
    expect(interaction.outcome).toBe("committed");
    const spans = on("Interactions").filter(m => m.label !== "Interactions");
    expect(spans[0]).toMatchObject({
      label: formatOrigin(interaction.origin),
      start: interaction.at + (interaction.inputDelayMs ?? 0),
      color: "primary"
    });
    expect(spans[0].end).toBeCloseTo(spans[0].start + interaction.handlerMs, 6);
    expect(spans[0].properties).toEqual(
      expect.arrayContaining([
        ["Writes", "1"],
        ["Re-runs", expect.stringMatching(/^2 \(/)],
        ["Outcome", "committed"]
      ])
    );
    // The settle: from the handler's return to the drain that committed the write.
    expect(spans[1]).toMatchObject({ label: "committed", color: "secondary-light" });
    expect(spans[1].start).toBe(spans[0].end);
    expect(spans[1].end).toBeCloseTo(interaction.at + interaction.settledMs!, 6);

    // The memo and the effect: on their tracks, `at → at + totalMs`, why-chain as tooltip.
    const memo = reruns.find(r => r.nodeName === "doubled")!;
    const effect = reruns.find(r => r.nodeName === "paint")!;
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
    createRoot(() => {
      const doubled = createMemo(() => n() * 2, { name: "doubled" });
      createRenderEffect(doubled, () => {}, { name: "paint" });
    });
    flush();
    // Creation: one span per node born, on its kind's track, labelled `· create`.
    const memoCreate = on("Memos").find(m => m.label.endsWith("doubled · create"))!;
    const effectCreate = on("Effects").find(m => m.label.endsWith("paint · create"))!;
    expect(memoCreate).toBeDefined();
    expect(effectCreate).toBeDefined();
    expect(memoCreate.end).toBeGreaterThanOrEqual(memoCreate.start);
    expect(memoCreate.properties).toEqual(
      expect.arrayContaining([
        ["Deps", "1"],
        ["Phase", "plain"]
      ])
    );
    // The first callback: after its compute, no run to join to.
    const firstCallback = on("Effects").find(m => m.label.endsWith("paint · callback"))!;
    expect(firstCallback).toBeDefined();
    expect(firstCallback.start).toBeGreaterThanOrEqual(effectCreate.start);
    expect(firstCallback.properties!.some(([k]) => k === "Run")).toBe(false);

    OBSERVE!.attribution.withInteraction({ type: "click", target: 'button#next "Next →"' }, () =>
      setN(1)
    );
    flush();
    // The re-run's callback joins its compute run by number and follows it in time.
    const rerun = runs.find(r => r.nodeName === "paint")!;
    const callbacks = on("Effects").filter(m => m.label.endsWith("paint · callback"));
    expect(callbacks).toHaveLength(2);
    expect(callbacks[1].properties).toEqual(
      expect.arrayContaining([
        ["Run", String(rerun.run)],
        ["Interaction", formatOrigin(rerun.interaction!)]
      ])
    );
    expect(callbacks[1].start).toBeGreaterThanOrEqual(rerun.at + rerun.totalMs - 0.001);
    expect(callbacks[1].color).toBe("secondary-light");
    // The wave that served the click: named by the write and the click,
    // two re-runs, nothing created, not held. (The mount itself ran
    // synchronously under createRoot — no drain, so no wave.)
    const waves = waveSpans(on("Propagation"));
    expect(waves).toHaveLength(1);
    const [wave] = waves;
    expect(wave).toMatchObject({
      label: `count 0 → 1 — ${formatOrigin(rerun.interaction!)} · 2 runs`,
      color: "primary"
    });
    expect(wave.start).toBeLessThanOrEqual(rerun.at);
    expect(wave.end).toBeGreaterThanOrEqual(callbacks[1].end);
    expect(wave.properties).toEqual(
      expect.arrayContaining([
        ["Writes", "count 0 → 1"],
        ["Re-runs", "2"],
        ["Unchanged", "0 (wasted)"],
        ["Created", "0"],
        ["Held", "no"],
        ["Interaction", formatOrigin(rerun.interaction!)]
      ])
    );
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
    await new Promise(r => setTimeout(r, 10));
    resolve("a");
    await until(() => shown.includes("a-p1"));
    const spans = on("Async").filter(m => m.label !== "Async");
    const landed = spans.find(m => m.label === "posts")!;
    const fallback = spans.find(m => m.label.startsWith("fallback"))!;
    expect(landed).toMatchObject({ color: "secondary" });
    expect(landed.end - landed.start).toBeGreaterThanOrEqual(8);
    expect(landed.properties).toEqual(expect.arrayContaining([["Outcome", "landed"]]));
    expect(fallback).toMatchObject({ color: "tertiary" });
    expect(fallback.end - fallback.start).toBeGreaterThanOrEqual(8);
    expect(fallback.properties![0][0]).toBe("Shown");

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

    OBSERVE!.attribution.withInteraction({ type: "click", target: 'button#next "Next →"' }, () =>
      setPage(2)
    );
    flush();
    await new Promise(r => setTimeout(r, 10));
    resolve("b");
    await until(() => shown.includes("b-p2"));

    const [hold] = holds;
    const [interaction] = interactions;
    expect(interaction.outcome).toBe("held");
    const [holdSpan] = on("Holds").filter(m => m.label !== "Holds");
    expect(holdSpan).toMatchObject({
      label: "waiting on posts",
      start: hold.at,
      end: hold.at + hold.holdMs,
      color: "warning" // silent: nothing acknowledged the wait
    });
    expect(holdSpan.properties).toEqual(
      expect.arrayContaining([
        ["Held writes", "page 1 → 2"], // dev: previews shown (see the scrub test)
        ["Acknowledged by", "nothing"],
        ["Verdict", "silent hold — no feedback while waiting"],
        ["Interaction", formatOrigin(interaction.origin)]
      ])
    );
    const settle = on("Interactions").find(m => m.label === "held")!;
    expect(settle.color).toBe("warning");
    expect(settle.end).toBeCloseTo(interaction.at + interaction.settledMs!, 6);
  });

  test("a navigation: request → settle on the Navigations track, named by route", () => {
    const { on } = measures();
    enable();
    const [location, setLocation] = createSignal("/users", { name: "location" });
    createRoot(() => createRenderEffect(location, () => {}, { name: "router" }));
    flush();
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
      color: "secondary"
    });
    expect(span.end).toBeGreaterThan(span.start);
    expect(span.properties).toEqual(
      expect.arrayContaining([
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
