/**
 * `@solidjs/web/performance-tracks` — Solid's records on the Chrome
 * Performance panel.
 *
 * The attribution engine (`solid-js/attribution`) already knows why every
 * effect and memo ran, what each click cost until the screen settled, which
 * holds the user waited in and what they waited on, which route a
 * navigation was, and — through `OBSERVE.records` — every server-function
 * call the browser made. This module is a second RENDERING of those same
 * records: where `@solidjs/diagnostics` writes them into an artifact an
 * agent reads, this paints them as custom tracks (group `Solid`) beside
 * Chrome's own main-thread and network tracks, using the panel's
 * extensibility API (`console.timeStamp` with a track, `performance.measure`
 * with `detail.devtools`). Same records, same formatters (`formatRerun`,
 * `formatOrigin`, `ownerPath`), so what the human sees on the timeline is
 * what the agent read — and every span answers "why", not only "how long".
 *
 * Every entry is emitted RETROACTIVELY, from the `performance.now()`
 * timestamps the engine already stamps on its records, at the moment the
 * record is delivered: the hot paths are never bracketed and the timeline
 * shows the engine's own numbers. Dev and observe tiers; a no-op in prod
 * (the module folds to `enablePerformanceTracks = () => noop`).
 *
 * @example
 * ```ts
 * import { enablePerformanceTracks } from "@solidjs/web/performance-tracks";
 *
 * const disable = enablePerformanceTracks();
 * // …record a trace in the Performance panel; the `Solid` group appears…
 * disable();
 * ```
 */
import { OBSERVE, diagnosticGuideUrl, ownerPath } from "solid-js";
import type {
  ChangeOrigin,
  ChangeRecord,
  CreateEvent,
  DiagnosticEvent,
  EffectRunEvent,
  FallbackEvent,
  FlightEvent,
  FlushEvent,
  HeldWrite,
  HoldEvent,
  InteractionEvent,
  NavigationEvent,
  Observe,
  RerunEvent
} from "solid-js";
import type { CallEvent, CallLive, FrameEvent } from "@solidjs/web";
import {
  attribution,
  formatOrigin,
  formatRerun,
  isLongHold,
  isSilentHold,
  type AttributionOptions
} from "solid-js/attribution";

// Replaced per build (see rollup.config.js); module consts so the gates
// below read as booleans and the prod build folds every branch.
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

export interface PerformanceTracksOptions {
  /**
   * Options for the engine hold this adapter takes
   * (`attribution.enable({ log: false, ...attribution })`). The adapter asks
   * for no console log — the timeline is the output — which, the engine
   * combining holds by the most demanding request, quiets the console only
   * while nobody else wants it: a console session beside the tracks keeps
   * its log. `checks` is left to the engine's default; pass `checks: false`
   * for records only (honoured while no other holder wants the checks).
   */
  attribution?: AttributionOptions;
  /**
   * Floor for run spans on `Propagation`, `Effects` and `Memos` — compute
   * runs (by `totalMs`), creation runs and effect callbacks (by their
   * duration): spans under it are not painted. The wave span on
   * `Propagation` always is, and its label carries the counts, so a
   * fan-out of runs too small to paint still reads as `47 runs`. Default
   * `0` in dev (every run; Chrome shows zero-width spans zoomed in) and
   * `0.05` in observe builds, so a production trace carries the runs that
   * cost something.
   */
  minMs?: number;
  /**
   * Emit through `performance.measure` with `detail.devtools` — tooltips
   * (the why-chain of a re-run) and properties (causes, deps, blockers…)
   * on every span — instead of `console.timeStamp`. Costs a User Timing
   * entry per span; the adapter clears the entries it made in batches (a
   * name it shares with an app measure is left alone). Default: dev builds.
   * Each path falls back to the other where its API is missing.
   */
  rich?: boolean;
  /** The track group name. Default `"Solid"`. */
  group?: string;
  /**
   * Drop what a shared trace should not carry: value previews on causes
   * and held writes, and target text on anything but a `button` or `a`
   * (the production-observability posture). Default: observe builds
   * (`!IS_DEV`); dev shows everything.
   */
  scrub?: boolean;
}

/** The Performance panel's palette for extension entries. */
type TrackColor =
  | "primary"
  | "primary-light"
  | "primary-dark"
  | "secondary"
  | "secondary-light"
  | "secondary-dark"
  | "tertiary"
  | "tertiary-light"
  | "tertiary-dark"
  | "error"
  | "warning";

type Properties = [string, string][];

/**
 * A `console.createTask` task — the JSX site a component was rendered from,
 * stored on the component's owner in dev (`_component.task`). Emitting an
 * entry inside `task.run` gives it that site as its stack in the panel.
 */
interface ConsoleTask {
  run<T>(fn: () => T): T;
}

/**
 * The panel's Insights annotation on an entry (`detail.devtools.performanceIssue`,
 * the shape React's tracks emit; Chrome ignores it where unsupported).
 */
interface PerformanceIssue {
  name: string;
  severity: "info" | "warning" | "error";
  description: string;
  learnMoreUrl?: string;
}

interface Emitter {
  /** Tooltips and properties are carried (the `performance.measure` path). */
  readonly rich: boolean;
  span(
    label: string,
    start: number,
    end: number,
    track: string,
    color: TrackColor,
    tooltip?: string,
    properties?: Properties,
    task?: ConsoleTask
  ): void;
  /**
   * A marker on the panel's Timings track at the current time — a finding
   * as it is delivered. Rich mode carries the issue annotation.
   */
  mark(
    label: string,
    color: TrackColor,
    tooltip?: string,
    properties?: Properties,
    issue?: PerformanceIssue,
    task?: ConsoleTask
  ): void;
  /** Release what the emitter holds (rich mode: its User Timing entries). */
  dispose(): void;
}

/**
 * The tracks, in display order. Each is seeded with a zero-length entry at
 * t=0.003 when the adapter starts, so the panel lays them out in this
 * order regardless of which record arrives first.
 */
const TRACKS = {
  interactions: "Interactions",
  propagation: "Propagation",
  effects: "Effects",
  memos: "Memos",
  async: "Async",
  holds: "Holds",
  navigations: "Navigations",
  server: "Server"
} as const;

const noop = (): void => {};

/**
 * Paint the attribution engine's records — and the web runtime's
 * server-function `call` and `frame` records, with the server's own timing
 * for each response under them (its `Server-Timing` metrics, placed by the
 * browser's resource timing; the document's at enable) — as tracks in the
 * Chrome Performance panel, from now until the returned function is called. The
 * tracks themselves are Chrome's (its `detail.devtools` extension); in rich
 * mode the spans are standard User Timing measures underneath, so any tool
 * that reads those — Firefox's profiler, Lighthouse, RUM — sees the same
 * spans as plain measures.
 *
 * Takes its own hold on the engine (`attribution.enable`): enabling beside
 * a diagnostics capture or an APM adapter disturbs neither, and releasing
 * here leaves theirs in place. Subscribing
 * to the engine's timeline records (`create`, `effect`, `flush`, `flight`,
 * `fallback`) is what turns them on — they are built only while a listener
 * exists, so the engine pays for them only while the tracks are enabled.
 * Every diagnostic delivered while enabled becomes a marker on the panel's
 * Timings track (`SILENT_HOLD — <Search>`), annotated as a
 * performance issue for the Insights sidebar when its severity is a
 * warning or worse. In dev, spans and markers are emitted inside the
 * `console.createTask` task of the component they belong to, so an entry's
 * stack in the panel points at the JSX site that rendered the component.
 *
 * One instance per page: the tracks are a view of one engine, and a second
 * painter would paint every span twice. A call while enabled joins the
 * running instance — its options are not re-read; the first call's apply —
 * and returns a release of its own; the instance is torn down when every
 * release has been called (a module re-evaluated by HMR that enables again
 * and disposes the old one lands back on one instance either way). A no-op
 * (returning a no-op) in prod builds, where the observe tier is absent, and
 * in an environment without `console.timeStamp` or `performance.measure`.
 */
export function enablePerformanceTracks(options: PerformanceTracksOptions = {}): () => void {
  if (!IS_OBSERVE) return noop;
  if (instance !== null) return instance.join();
  const observe = OBSERVE;
  if (observe === undefined) return noop;
  if (typeof performance !== "object" || typeof performance.now !== "function") return noop;
  const emitter = createEmitter(options.group ?? "Solid", options.rich ?? IS_DEV);
  if (emitter === undefined) return noop;

  const minMs = options.minMs ?? (IS_DEV ? 0 : 0.05);
  const scrub = options.scrub ?? !IS_DEV;
  const painter = new Painter(observe, emitter, minMs, scrub);
  const server = new ServerSpans(emitter);
  server.start();

  const releases = [
    () => server.dispose(),
    attribution.enable({ log: false, ...options.attribution }),
    attribution.subscribe("rerun", e => painter.rerun(e)),
    attribution.subscribe("create", e => painter.create(e)),
    attribution.subscribe("effect", e => painter.effect(e)),
    attribution.subscribe("flush", e => painter.flush(e)),
    attribution.subscribe("flight", e => painter.flight(e)),
    attribution.subscribe("fallback", e => painter.fallback(e)),
    attribution.subscribe("interaction", e => painter.interaction(e)),
    attribution.subscribe("hold", e => painter.hold(e)),
    attribution.subscribe("navigation", e => painter.navigation(e)),
    observe.records.subscribe("call", (e, live) => {
      painter.call(e);
      server.call(e, live);
    }),
    observe.records.subscribe("frame", e => painter.frame(e)),
    observe.diagnostics.subscribe(e => painter.diagnostic(e))
  ];
  const active: Instance = {
    holders: 0,
    join() {
      active.holders++;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        if (--active.holders > 0 || instance !== active) return;
        instance = null;
        for (const release of releases) release();
        emitter.dispose();
      };
    }
  };
  instance = active;
  return active.join();
}

/** The running adapter, if any (see `enablePerformanceTracks`). */
interface Instance {
  holders: number;
  join(): () => void;
}
let instance: Instance | null = null;

// --- Emission ------------------------------------------------------------------

/**
 * `console.timeStamp(label, start, end, track, group, color)` is the panel's
 * cheap path: no User Timing entry, nothing retained. `performance.measure`
 * with `detail.devtools` is the rich one — tooltips and properties — at the
 * price of an entry in the performance timeline per span, which the
 * adapter clears by name once a batch has accumulated (the trace has them
 * by then; clearing removes nothing from a recording). Each path falls back
 * to the other when its API is missing; `undefined` when neither exists.
 *
 * The emitter is the one place the adapter calls host APIs from inside the
 * engine's hooks, so it is the one guard: a throw from `performance` or
 * `console` (a hostile polyfill, a timestamp the host refuses) is caught
 * here and never reaches the engine's record loop — the span is dropped,
 * and dev says so once.
 */
function createEmitter(group: string, rich: boolean): Emitter | undefined {
  const hasMeasure = typeof performance.measure === "function";
  const hasTimeStamp = typeof console !== "undefined" && typeof console.timeStamp === "function";
  let emitter: Emitter;
  if ((rich && hasMeasure) || (!hasTimeStamp && hasMeasure)) {
    // Our entries by name, counted: a name is cleared only while every entry
    // under it is ours, so an app measure that shares a label is never
    // clobbered (and ours stay with it — the cost of the collision).
    const names = new Map<string, number>();
    const markNames = new Map<string, number>();
    let pending = 0;
    const clear = () => {
      pending = 0;
      clearOwned(names, "measure", performance.clearMeasures);
      clearOwned(markNames, "mark", performance.clearMarks);
    };
    const hasMark = typeof performance.mark === "function";
    emitter = {
      rich: true,
      span(label, start, end, track, color, tooltip, properties, task) {
        const devtools: Record<string, unknown> = {
          dataType: "track-entry",
          track,
          trackGroup: group,
          color
        };
        if (tooltip !== undefined) devtools.tooltipText = tooltip;
        if (properties !== undefined) devtools.properties = properties;
        const measure = () => performance.measure(label, { start, end, detail: { devtools } });
        if (!guarded(measure, task)) return;
        names.set(label, (names.get(label) ?? 0) + 1);
        if (++pending >= CLEAR_EVERY) clear();
      },
      mark(label, color, tooltip, properties, issue, task) {
        if (!hasMark) return;
        const devtools: Record<string, unknown> = { dataType: "marker", color };
        if (tooltip !== undefined) devtools.tooltipText = tooltip;
        if (properties !== undefined) devtools.properties = properties;
        if (issue !== undefined) devtools.performanceIssue = issue;
        const mark = () => performance.mark(label, { detail: { devtools } });
        if (!guarded(mark, task)) return;
        markNames.set(label, (markNames.get(label) ?? 0) + 1);
        if (++pending >= CLEAR_EVERY) clear();
      },
      dispose: clear
    };
  } else if (hasTimeStamp) {
    // The six-argument form (Chrome 128+); older consoles take the label
    // and ignore the rest, which is a plain timeline mark — harmless.
    const timeStamp = console.timeStamp as (...args: (string | number)[]) => void;
    emitter = {
      rich: false,
      span(label, start, end, track, color, _tooltip, _properties, task) {
        guarded(() => timeStamp(label, start, end, track, group, color), task);
      },
      mark(label, _color, _tooltip, _properties, _issue, task) {
        // The one-argument form: a marker on the Timings track, now.
        guarded(() => timeStamp(label), task);
      },
      dispose: noop
    };
  } else return undefined;
  // Seed the tracks in order (zero-length entries the panel sorts by).
  for (const track of Object.values(TRACKS)) {
    emitter.span(track, SEED_AT, SEED_AT, track, "primary-light");
  }
  return emitter;
}

/** Where the seeding entries sit — before anything the app could stamp. */
const SEED_AT = 0.003;
/** Rich mode: clear the User Timing entries after this many spans. */
const CLEAR_EVERY = 500;

/** Run a host call (inside the component's task when there is one); `false` if it threw. */
let warnedThrow = false;
function guarded(fn: () => void, task: ConsoleTask | undefined): boolean {
  try {
    task !== undefined ? task.run(fn) : fn();
    return true;
  } catch (error) {
    if (IS_DEV && !warnedThrow) {
      warnedThrow = true;
      console.warn("[performance-tracks] a timeline entry could not be emitted; dropped.", error);
    }
    return false;
  }
}

/**
 * Clear the User Timing entries under the names we made — a name only while
 * the timeline holds no more of it than we made (an app's entry of the same
 * name keeps the name, ours included, until the app clears it).
 */
function clearOwned(
  owned: Map<string, number>,
  type: "measure" | "mark",
  clearFn: ((name?: string) => void) | undefined
): void {
  if (typeof clearFn !== "function" || typeof performance.getEntriesByName !== "function") {
    owned.clear();
    return;
  }
  for (const [name, count] of owned) {
    // More entries than ours: the app owns some; leave the name alone. Fewer
    // (something cleared the timeline under us): nothing but ours can remain.
    if (performance.getEntriesByName(name, type).length <= count) {
      clearFn.call(performance, name);
      owned.delete(name);
    }
  }
}

// --- Painting ------------------------------------------------------------------

class Painter {
  private readonly rich: boolean;
  /**
   * The wave under construction — what the current drain has propagated so
   * far, folded into the `Propagation` wave span when its `flush` record
   * arrives: the root writes (by identity: one write reaches many runs
   * through many chains) and how many runs did nothing.
   */
  private roots = new Set<ChangeRecord>();
  private unchanged = 0;
  /**
   * Short labels of the nodes that ran this drain, by `nodeId`, so a run's
   * causes name the memo as the timeline shows it (collapsed to its flow
   * tag or primitive) rather than by the raw `name` on the cause record.
   * Producers run before their consumers, so the entry exists by the time
   * the consumer's record arrives; cleared per drain to stay bounded.
   */
  private readonly names = new Map<number, string>();
  constructor(
    private readonly observe: Observe,
    private readonly emit: Emitter,
    private readonly minMs: number,
    private readonly scrub: boolean
  ) {
    this.rich = emit.rich;
  }

  /**
   * `Effects` / `Memos`: one span per re-run, `at → at + totalMs`, labelled
   * by the owner path from its nearest component (`<TodoRow> › syncTitle`;
   * the full path is the `Owner path` property), coloured
   * by self time like React's component flame — and `warning` when the
   * run provably did nothing (`changed: false`), `tertiary` under an
   * optimistic lane. The tooltip is the engine's own why-chain.
   *
   * `Propagation`: the same run inside its wave, labelled by what made it
   * run (`<TodoRow> › effect ← doubled`), so the wave reads as the graph
   * the write travelled: a wide flat wave is a coarse signal everyone
   * depends on; a deep one is a chain of memos; a `warning` node with no
   * dependants after it is the equality cutoff doing its job.
   */
  rerun(event: RerunEvent): void {
    collectRoots(event.causes, this.roots);
    if (!event.changed) this.unchanged++;
    const subject = this.observe.subjectOf(event);
    const node = describe(event.nodeName, ownerPath(subject));
    this.names.set(event.nodeId, node.short);
    if (event.totalMs < this.minMs) return;
    const track = event.nodeKind === "effect" ? TRACKS.effects : TRACKS.memos;
    const color: TrackColor =
      event.phase === "optimistic"
        ? "tertiary"
        : !event.changed
          ? "warning"
          : bySelfTime(event.selfMs);
    let tooltip: string | undefined;
    let properties: Properties | undefined;
    if (this.rich) {
      tooltip = this.scrub ? formatRerun(scrubRerun(event)) : formatRerun(event);
      properties = [
        ["Run", `${event.run} (run ${event.nodeRuns} of this node)`],
        ["Self time", ms(event.selfMs)],
        ["Total time", ms(event.totalMs)],
        ["Changed", event.changed ? "yes" : "no — unchanged (wasted)"],
        ["Phase", event.phase + (event.held ? ", held" : "")],
        ["Deps", String(event.depCount)]
      ];
      this.identity(properties, node, event.nodeId);
      if (event.depsAdded.length > 0) properties.push(["Deps added", event.depsAdded.join(", ")]);
      if (event.depsRemoved.length > 0)
        properties.push(["Deps removed", event.depsRemoved.join(", ")]);
      if (event.causes.length > 0)
        properties.push(["Causes", event.causes.map(c => rootCause(c, this.scrub)).join("; ")]);
      const origin = rootOrigin(event.causes);
      if (origin !== undefined && origin !== event.interaction)
        properties.push(["Origin", this.origin(origin)]);
      if (event.interaction !== undefined)
        properties.push(["Interaction", this.origin(event.interaction)]);
    }
    const end = event.at + event.totalMs;
    const task = taskOf(subject);
    this.emit.span(node.label, event.at, end, track, color, tooltip, properties, task);
    this.emit.span(
      `${node.label} ← ${this.causeLabels(event.causes)}`,
      event.at,
      end,
      TRACKS.propagation,
      color,
      tooltip,
      properties,
      task
    );
  }

  /**
   * `Effects` / `Memos`: a creation run — the mount flame. Same lane and
   * palette as a re-run, labelled `· create`, so a mount storm reads as a
   * wall of creation spans under the interaction that built them. On
   * `Propagation` too: a wave that builds nodes (a `<Show>` flipping, a
   * `<For>` growing) shows what it mounted beside what it re-ran.
   */
  create(event: CreateEvent): void {
    const subject = this.observe.subjectOf(event);
    const node = describe(event.nodeName, ownerPath(subject));
    this.names.set(event.nodeId, node.short);
    if (event.totalMs < this.minMs) return;
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [
        ["Self time", ms(event.selfMs)],
        ["Total time", ms(event.totalMs)],
        ["Phase", event.phase + (event.held ? ", held" : "")],
        ["Deps", String(event.depCount)]
      ];
      this.identity(properties, node, event.nodeId);
      if (event.interaction !== undefined)
        properties.push(["Interaction", this.origin(event.interaction)]);
    }
    const label = `${node.label} · create`;
    const end = event.at + event.totalMs;
    const color: TrackColor = event.phase === "optimistic" ? "tertiary" : bySelfTime(event.selfMs);
    const task = taskOf(subject);
    this.emit.span(
      label,
      event.at,
      end,
      event.nodeKind === "effect" ? TRACKS.effects : TRACKS.memos,
      color,
      undefined,
      properties,
      task
    );
    this.emit.span(label, event.at, end, TRACKS.propagation, color, undefined, properties, task);
  }

  /**
   * `Effects`: the callback — the imperative half that writes the DOM —
   * as its own span after the compute run it belongs to, in the secondary
   * palette so the two halves read apart. On `Propagation` it is the leaf
   * of the wave: where the write finally reached the screen.
   */
  effect(event: EffectRunEvent): void {
    if (event.durationMs < this.minMs) return;
    const subject = this.observe.subjectOf(event);
    const node = describe(event.nodeName, ownerPath(subject));
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [["Duration", ms(event.durationMs)]];
      this.identity(properties, node, event.nodeId);
      if (event.run !== undefined) properties.push(["Run", String(event.run)]);
      if (event.interaction !== undefined)
        properties.push(["Interaction", this.origin(event.interaction)]);
    }
    const label = `${node.label} · callback`;
    const end = event.at + event.durationMs;
    const color: TrackColor =
      event.durationMs < 10 ? "secondary-light" : event.durationMs < 100 ? "secondary" : "error";
    const task = taskOf(subject);
    this.emit.span(label, event.at, end, TRACKS.effects, color, undefined, properties, task);
    this.emit.span(label, event.at, end, TRACKS.propagation, color, undefined, properties, task);
  }

  /**
   * Timings track: a finding as a marker where it was delivered, labelled
   * by its code and the owner it is about (`SILENT_HOLD — <Search>`, the
   * full path in `Owner path`), coloured by severity. A `warn`-or-worse finding is also annotated as a
   * performance issue — the panel's Insights sidebar lists those — with the
   * repair guide's section for the code as its link. `info` stays a plain
   * marker. The message and `data` are the engine's own; under the scrub
   * only the code, kind and owner are carried (a responsiveness finding's
   * sentence names the element the user hit).
   */
  diagnostic(event: DiagnosticEvent): void {
    const owner = event.ownerPath?.join(" › ");
    const label =
      event.ownerPath !== undefined
        ? `${event.code} — ${nearest(event.ownerPath).join(" › ")}`
        : event.code;
    const color: TrackColor =
      event.severity === "error"
        ? "error"
        : event.severity === "warn"
          ? "warning"
          : "primary-light";
    let tooltip: string | undefined;
    let properties: Properties | undefined;
    let issue: PerformanceIssue | undefined;
    if (this.rich) {
      tooltip = this.scrub ? `${event.kind} finding ${event.code}` : event.message;
      properties = [
        ["Code", event.code],
        ["Kind", event.kind],
        ["Severity", event.severity]
      ];
      if (owner !== undefined) properties.push(["Owner path", owner]);
      if (event.nodeName !== undefined) properties.push(["Node", event.nodeName]);
      if (!this.scrub) {
        properties.push(["Message", event.message]);
        if (event.data !== undefined) {
          // The primitive fields ride along (`holdMs`, `relay`, `soleWriter`);
          // structured ones (`interaction`, `navigation`) are the message's.
          for (const [key, value] of Object.entries(event.data)) {
            if (typeof value === "number")
              properties.push([key, Number.isInteger(value) ? String(value) : value.toFixed(2)]);
            else if (typeof value === "string" || typeof value === "boolean")
              properties.push([key, String(value)]);
          }
        }
      }
      properties.push(["Guide", diagnosticGuideUrl(event.code)]);
      if (event.severity !== "info") {
        issue = {
          name: `Solid: ${event.code}`,
          severity: event.severity === "error" ? "error" : "warning",
          description: tooltip,
          learnMoreUrl: diagnosticGuideUrl(event.code)
        };
      }
    }
    this.emit.mark(label, color, tooltip, properties, issue, taskOf(this.observe.subjectOf(event)));
  }

  /**
   * The identity properties every node span carries in rich mode: the
   * runtime's full owner path (the label folds flow internals and composed
   * primitives — this is the unfolded truth), the folded node's runtime
   * name when there is one, and the engine's node id (what `why()` and
   * `subjectOf` key on).
   */
  private identity(properties: Properties, node: Described, nodeId: number): void {
    if (node.path !== undefined) properties.push(["Owner path", node.path]);
    if (node.internal !== undefined) properties.push(["Node", node.internal]);
    properties.push(["Node id", String(nodeId)]);
  }

  /**
   * `Propagation`: the wave — one span per drain, `at → at + durationMs`,
   * labelled by the writes that started it and what they reached
   * (`count 0 → 1 — click on button#next · 5 runs, 1 unchanged`). The runs
   * painted inside it (see `rerun`) sit beneath it on the track by time,
   * so the flame under a wave IS its propagation. `tertiary` when the
   * drain parked a transition, `warning` when half or more of what it
   * re-ran was unchanged, otherwise the primary palette by duration.
   */
  flush(event: FlushEvent): void {
    const roots = [...this.roots];
    const unchanged = this.unchanged;
    this.roots.clear();
    this.unchanged = 0;
    this.names.clear();
    let label = roots.length > 0 ? this.writes(roots, 3) : "flush";
    const origin =
      event.interaction ??
      roots.map(r => r.origin).find(o => o !== undefined && o.kind !== "external");
    if (origin !== undefined) label += ` — ${this.origin(origin)}`;
    label += ` · ${event.runs} ${event.runs === 1 ? "run" : "runs"}`;
    if (unchanged > 0) label += `, ${unchanged} unchanged`;
    if (event.created > 0) label += `, ${event.created} created`;
    if (event.held) label += " · held";
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [
        ["Duration", ms(event.durationMs)],
        ["Writes", roots.length > 0 ? this.writes(roots, Infinity) : "none"],
        ["Re-runs", String(event.runs)],
        ["Unchanged", `${unchanged} (wasted)`],
        ["Created", String(event.created)],
        ["Held", event.held ? "yes — a transition parked" : "no"]
      ];
      if (event.interaction !== undefined)
        properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(
      label,
      event.at,
      event.at + event.durationMs,
      TRACKS.propagation,
      event.held
        ? "tertiary"
        : unchanged > 0 && unchanged * 2 >= event.runs
          ? "warning"
          : event.durationMs < 16
            ? "primary"
            : "primary-dark",
      undefined,
      properties
    );
  }

  /**
   * `Async`: a flight, origin → landing, labelled by the async node's owner
   * path; `warning` when it was abandoned (superseded before it landed —
   * the re-ask storm's signature).
   */
  flight(event: FlightEvent): void {
    const node = describe(event.nodeName, event.ownerPath);
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [
        ["In the air", ms(event.durationMs)],
        ["Outcome", event.outcome]
      ];
      if (node.path !== undefined) properties.push(["Owner path", node.path]);
      if (node.internal !== undefined) properties.push(["Node", node.internal]);
      if (event.interaction !== undefined)
        properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(
      `${node.label}${event.outcome === "abandoned" ? " · abandoned" : ""}`,
      event.at,
      event.at + event.durationMs,
      TRACKS.async,
      event.outcome === "abandoned" ? "warning" : "secondary",
      undefined,
      properties,
      taskOf(this.observe.subjectOf(event))
    );
  }

  /**
   * `Async`: a loading boundary's fallback, show → hide, named by the
   * boundary from its nearest component (`fallback <Page> › <Loading>`).
   */
  fallback(event: FallbackEvent): void {
    const path = event.ownerPath;
    const label = `fallback${path !== undefined ? ` ${nearest(path).join(" › ")}` : ""}`;
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [["Shown", ms(event.shownMs)]];
      if (path !== undefined && nearest(path).length !== path.length)
        properties.push(["Owner path", path.join(" › ")]);
      if (event.interaction !== undefined)
        properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(
      label,
      event.at,
      event.at + event.shownMs,
      TRACKS.async,
      "tertiary",
      undefined,
      properties,
      taskOf(this.observe.subjectOf(event))
    );
  }

  /**
   * `Interactions`: the input delay the browser's INP counts first (event
   * creation → handler entry, when the runtime dated the event), the
   * handler itself, and — when the handler wrote — the settle: the drain
   * that committed its writes or the commit of the hold they waited in.
   * `warning` when it settled through a silent hold.
   */
  interaction(event: InteractionEvent): void {
    const label = this.origin(event.origin);
    const handlerStart = event.at + (event.inputDelayMs ?? 0);
    const handlerEnd = handlerStart + event.handlerMs;
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [
        ["Handler", ms(event.handlerMs)],
        ["Writes", String(event.writes)],
        ["Re-runs", `${event.runs} (${ms(event.runMs)} self time)`],
        ["Created", String(event.created)]
      ];
      if (event.inputDelayMs !== undefined)
        properties.unshift(["Input delay", ms(event.inputDelayMs)]);
      if (event.settledMs !== undefined) properties.push(["Settled", ms(event.settledMs)]);
      if (event.outcome !== undefined) properties.push(["Outcome", event.outcome]);
      if (event.holds.length > 0) properties.push(["Holds", String(event.holds.length)]);
      if (event.navigations.length > 0)
        properties.push([
          "Navigations",
          event.navigations.map(n => this.origin(n.origin)).join("; ")
        ]);
    }
    if (event.inputDelayMs !== undefined && event.inputDelayMs > 0) {
      this.emit.span("input delay", event.at, handlerStart, TRACKS.interactions, "primary-light");
    }
    this.emit.span(
      label,
      handlerStart,
      handlerEnd,
      TRACKS.interactions,
      "primary",
      undefined,
      properties
    );
    const outcome = event.outcome;
    if (event.settledMs === undefined || outcome === undefined || outcome === "idle") return;
    const settleEnd = event.at + event.settledMs;
    if (settleEnd <= handlerEnd) return;
    const silent = outcome === "held" && event.holds.some(isSilentHold);
    this.emit.span(
      outcome,
      handlerEnd,
      settleEnd,
      TRACKS.interactions,
      silent ? "warning" : outcome === "held" ? "tertiary" : "secondary-light",
      undefined,
      this.rich ? [["Settled", ms(event.settledMs)]] : undefined
    );
  }

  /**
   * `Holds`: the wait, `at → at + holdMs`, labelled by what it waited on;
   * `warning` when the screen never acknowledged it (silent), `error` when
   * its quiescent tail outlasted the long-hold threshold — the engine's own
   * verdicts, not thresholds of this adapter's.
   */
  hold(event: HoldEvent): void {
    const long = isLongHold(event);
    const silent = isSilentHold(event);
    const what = event.blockers.length > 0 ? event.blockers.join(", ") : "a transition";
    const label =
      event.origin !== undefined
        ? `${this.origin(event.origin)} — waiting on ${what}`
        : `waiting on ${what}`;
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [
        ["Held", ms(event.holdMs)],
        ["Tail", `${ms(event.tailMs)} (last write → commit)`],
        ["Flushes", String(event.flushes)],
        ["Held writes", event.heldWrites.map(w => heldWrite(w, this.scrub)).join(", ") || "none"],
        [
          "Acknowledged by",
          event.acknowledgements.map(a => `${a.kind}(${a.source})`).join(", ") || "nothing"
        ],
        ["Painted during hold", String(event.paintedDuringHold)]
      ];
      if (silent) properties.push(["Verdict", "silent hold — no feedback while waiting"]);
      if (long) properties.push(["Verdict", "long hold"]);
      if (event.action) properties.push(["Action", "yes"]);
      if (event.interaction !== undefined)
        properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(
      label,
      event.at,
      event.at + event.holdMs,
      TRACKS.holds,
      long ? "error" : silent ? "warning" : "tertiary",
      undefined,
      properties
    );
  }

  /** `Navigations`: request → settle, labelled by the route pattern. */
  navigation(event: NavigationEvent): void {
    if (event.settledMs === undefined) return;
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [
        ["Settled", ms(event.settledMs)],
        ["Writes", String(event.writes)]
      ];
      if (event.to !== undefined) properties.push(["To", event.to]);
      if (event.from !== undefined) properties.push(["From", event.from]);
      if (event.params !== undefined) {
        const params = Object.entries(event.params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        if (params) properties.push(["Params", params]);
      }
      if (event.redirects !== undefined)
        properties.push([
          "Redirected from",
          event.redirects.map(hop => hop.to ?? hop.name ?? "?").join(" → ")
        ]);
      if (event.outcome !== undefined) properties.push(["Outcome", event.outcome]);
      if (event.interaction !== undefined)
        properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(
      formatOrigin(event.origin),
      event.at,
      event.at + event.settledMs,
      TRACKS.navigations,
      event.outcome === "superseded"
        ? "secondary-light"
        : event.outcome === "held"
          ? "tertiary"
          : "secondary",
      undefined,
      properties
    );
  }

  /** `Server`: one span per server-function call the browser made. */
  call(event: CallEvent): void {
    let label = `${event.method} ${event.id}`;
    if (event.status !== undefined) label += ` · ${event.status}`;
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [
        ["Duration", ms(event.durationMs)],
        ["Outcome", event.outcome]
      ];
      if (event.status !== undefined) properties.push(["Status", String(event.status)]);
      if (event.deferred) properties.push(["Deferred", "the body is consumed by the caller"]);
      if (event.origin !== undefined) properties.push(["Origin", this.origin(event.origin)]);
    }
    this.emit.span(
      label,
      event.at,
      event.at + event.durationMs,
      TRACKS.server,
      event.outcome === "error" ? "error" : "secondary",
      undefined,
      properties
    );
  }

  /**
   * `Server`: a frame stream applied on the client — the read and apply of
   * a server-component response — with its time-to-shell as a lighter span.
   */
  frame(event: FrameEvent): void {
    if (event.side !== "client") return;
    const label = `frame ${event.id || "(unnamed)"}`;
    let properties: Properties | undefined;
    if (this.rich) {
      properties = [
        ["Duration", ms(event.durationMs)],
        ["Outcome", event.outcome],
        ["Chunks", String(event.chunks)],
        ["Fragments", String(event.fragments)],
        ["Slots", String(event.slots)],
        ["Regions", String(event.regions)],
        ["Errors", String(event.errors)],
        ["Version", String(event.version)]
      ];
      if (event.shellMs !== undefined) properties.splice(1, 0, ["Shell", ms(event.shellMs)]);
      if (event.address !== undefined) properties.push(["Applied as", event.address]);
    }
    if (event.shellMs !== undefined && event.shellMs > 0) {
      this.emit.span(
        `${label} · shell`,
        event.at,
        event.at + event.shellMs,
        TRACKS.server,
        "secondary-light"
      );
    }
    this.emit.span(
      label,
      event.at,
      event.at + event.durationMs,
      TRACKS.server,
      event.outcome === "complete" ? "secondary" : "error",
      undefined,
      properties
    );
  }

  /**
   * A run's immediate causes as `←` labels: memos by the short label their
   * own run was painted with this drain, signals by name; a landing as
   * `landed`, a self-invalidation as `refresh`. Deduplicated — a node with
   * two deps on one memo has one cause.
   */
  private causeLabels(causes: ChangeRecord[]): string {
    const labels = new Set<string>();
    for (const c of causes) {
      const name =
        (c.kind === "derived" && c.nodeId !== undefined ? this.names.get(c.nodeId) : undefined) ??
        c.name;
      labels.add(
        c.kind === "async" ? `${name} landed` : c.kind === "refresh" ? `refresh ${name}` : name
      );
    }
    return [...labels].join(", ");
  }

  /**
   * Root writes as one line, `count 0 → 1, name "a" → "b"`, values dropped
   * under the scrub; past `limit` writes, `+N more`.
   */
  private writes(roots: ChangeRecord[], limit: number): string {
    const shown = roots.slice(0, limit).map(r => {
      let out =
        r.kind === "async"
          ? `${r.name} landed`
          : r.kind === "refresh"
            ? `refresh ${r.name}`
            : r.name;
      if (!this.scrub && r.prev !== undefined) out += ` ${r.prev} → ${r.value}`;
      return out;
    });
    if (roots.length > limit) shown.push(`+${roots.length - limit} more`);
    return shown.join(", ");
  }

  /** `formatOrigin`, through the scrub when the trace may be shared. */
  private origin(origin: ChangeOrigin): string {
    return formatOrigin(this.scrub ? scrubOrigin(origin) : origin);
  }
}

// --- Node presentation ----------------------------------------------------------
//
// The owner path is the runtime's truth; the label is what a developer
// wrote. Two kinds of node sit between the two: the memos a flow control
// builds to do its job (`<Show>`'s `condition value` / `condition` /
// `value`, a boundary's `children` / `boundary` / `value`), and the nodes a
// composed primitive builds, which the compiler names `createDebounced.value`
// — `primitive.local`, the store convention (`store.user`). Both are folded
// on the label into the thing the developer wrote — `<App> › <Show>`,
// `<App> › createDebounced` — with the runtime's name kept in the span's
// `Node` property, so the label reads as source and the tooltip as graph.
//
// The label then starts at the nearest component the developer wrote:
// `<Search> › results`, not `<Document> › body › <App> › <Router> › … ›
// <Search> › results`. A track entry has the width of its span, and the
// panel elides the middle of a label that does not fit — which in a full
// path is exactly the part that says which component this is. Solid's own
// flow controls (`<Show>`, `<For>`, `<Loading>`…) are not anchors: a node
// under `<Card> › <Show>` belongs to `<Card>`. The full path is the
// `Owner path` property. Presentation only: every record is what the
// engine delivered.

interface Described {
  /** The label: the folded owner path from the nearest component, the node's own segment last. */
  label: string;
  /** The node's own segment as folded — what a dependant's `←` names it. */
  short: string;
  /** The runtime's name when the label folded it: `condition value`, `value`. */
  internal?: string;
  /** The runtime's full owner path, unfolded, when it differs from the label. */
  path?: string;
}

/** The nodes each flow control builds directly under its own owner. */
const FLOW_INTERNALS: Record<string, ReadonlySet<string> | undefined> = {
  "<Show>": new Set(["condition value", "condition", "value"]),
  "<Switch>": new Set([
    "children",
    "conditions",
    "condition value",
    "condition",
    "eval conditions"
  ]),
  "<Loading>": new Set(["children", "boundary", "value"]),
  "<Errored>": new Set(["children", "boundary", "value"]),
  "<Reveal>": new Set(["reveal order"])
};

/**
 * Solid's own flow and platform components — tags a developer writes, but
 * never "the component this node belongs to".
 */
const FLOW_TAGS: ReadonlySet<string> = new Set([
  "<Show>",
  "<For>",
  "<Repeat>",
  "<Switch>",
  "<Match>",
  "<Errored>",
  "<Loading>",
  "<Reveal>",
  "<Portal>",
  "<Dynamic>"
]);

/**
 * The segments from the nearest enclosing component — the last `<Tag>`
 * that is not one of Solid's own flow controls — to the end; the whole
 * path when there is none.
 */
function nearest(segments: readonly string[]): readonly string[] {
  for (let i = segments.length - 1; i > 0; i--) {
    const s = segments[i];
    if (s.charCodeAt(0) === 60 /* `<` */ && !FLOW_TAGS.has(s)) return segments.slice(i);
  }
  return segments;
}

function describe(nodeName: string, path: string[] | undefined): Described {
  const full =
    path === undefined
      ? [nodeName]
      : path[path.length - 1] === nodeName
        ? path
        : [...path, nodeName];
  const segments: string[] = [];
  let flow: ReadonlySet<string> | undefined;
  let internal: string | undefined;
  for (let i = 0; i < full.length; i++) {
    const name = full[i];
    let shown: string | undefined;
    if (flow !== undefined && flow.has(name)) {
      // A flow control's own node: folded into the tag before it. Stays
      // in `flow` — a boundary's `children` owns its `value`'s content.
      internal = name;
    } else {
      flow = FLOW_INTERNALS[name];
      const dot = name.indexOf(".");
      if (dot > 0 && name.charCodeAt(0) !== 60 /* `<` */) {
        shown = name.slice(0, dot);
        internal = name.slice(dot + 1);
      } else {
        shown = name;
        internal = undefined;
      }
    }
    if (shown !== undefined && shown !== segments[segments.length - 1]) segments.push(shown);
  }
  const short = segments[segments.length - 1];
  const label = nearest(segments).join(" › ");
  const described: Described = { label, short };
  if (internal !== undefined) described.internal = internal;
  const runtimePath = full.join(" › ");
  if (runtimePath !== label) described.path = runtimePath;
  return described;
}

/**
 * The console task of the component a subject belongs to — the nearest
 * component root above it carrying a dev `_component.task` — so an entry
 * about the subject reports the JSX site as its stack. Dev only: the record
 * exists only there; elsewhere the walk finds nothing and costs a few
 * pointer reads per painted span.
 */
function taskOf(subject: ReturnType<Observe["subjectOf"]>): ConsoleTask | undefined {
  if (!IS_DEV || !subject) return undefined;
  let owner: any = "_parent" in subject ? subject : (subject as any)._owner;
  for (; owner != null; owner = owner._parent) {
    const task = owner._component?.task;
    if (task !== undefined) return task as ConsoleTask;
  }
  return undefined;
}

/** The origin of the first root write behind a run's causes, if any is not `external`. */
function rootOrigin(causes: ChangeRecord[]): ChangeOrigin | undefined {
  for (const c of causes) {
    let root = c;
    while (root.causes !== undefined && root.causes.length > 0) root = root.causes[0];
    if (root.origin !== undefined && root.origin.kind !== "external") return root.origin;
  }
  return undefined;
}

/** Every root write reachable through a run's causes, by identity. */
function collectRoots(causes: ChangeRecord[], out: Set<ChangeRecord>): void {
  for (const c of causes) {
    if (c.kind === "derived") {
      if (c.causes !== undefined) collectRoots(c.causes, out);
    } else out.add(c);
  }
}

function bySelfTime(selfMs: number): TrackColor {
  return selfMs < 0.5
    ? "primary-light"
    : selfMs < 10
      ? "primary"
      : selfMs < 100
        ? "primary-dark"
        : "error";
}

// --- Server spans --------------------------------------------------------------
//
// What the server did inside a client span. The server runtime puts its
// timed work on the response's `Server-Timing` header (trace.ts
// `TimingMetric`: `solid-invocation` on a server-function response —
// `solid-shell` and the `solid-boundary`s that settled inside it on the
// document), and this paints those durations on the `Server` track under
// the client span they belong to, so the wire is the visible gap between
// the two. Placement comes from the browser's own resource timing: the
// head left the server right after the function returned, so a server
// span ENDS at the fetch's `responseStart` and runs back its `dur`. The
// resource entry is queued after the body is read and can land after the
// `call` record, so calls wait for it under a `PerformanceObserver`
// (painting late is exact — every stamp is historical). Without one, the
// span is centred in the call and says so.

/** A `Server-Timing` metric as the header carries it (and as `PerformanceServerTiming` exposes it). */
interface ServerMetric {
  name: string;
  duration: number;
  description: string;
}

/** A call whose resource entry has not arrived. */
interface PendingCall {
  event: CallEvent;
  url: string;
  metrics: ServerMetric[];
  expires: number;
}

/** The runtime's metric names; anything else on the header is the app's. */
const SOLID_METRIC = /^solid-(invocation|shell|boundary)$/;
/** How long a call waits for its resource entry before it is forgotten. */
const PENDING_MS = 30_000;

class ServerSpans {
  private readonly pending: PendingCall[] = [];
  private observer: PerformanceObserver | undefined;
  constructor(private readonly emit: Emitter) {}

  /** The document's own server spans, and the observer that places the calls'. */
  start(): void {
    this.navigation();
    if (typeof PerformanceObserver !== "function") return;
    try {
      const observer = new PerformanceObserver(list => this.resources(list.getEntries()));
      observer.observe({ type: "resource", buffered: true });
      this.observer = observer;
    } catch {
      // `resource` not observable here: calls are placed by the fallback.
      this.observer = undefined;
    }
  }

  dispose(): void {
    if (this.observer !== undefined) this.observer.disconnect();
    this.observer = undefined;
    this.pending.length = 0;
  }

  /** A server-function call settled: read its metrics, place them when the entry allows. */
  call(event: CallEvent, live: CallLive): void {
    const response = live.response;
    if (response === undefined) return;
    let header: string | null;
    try {
      header = response.headers.get("server-timing");
    } catch {
      return;
    }
    if (!header) return;
    const metrics = parseServerTiming(header).filter(m => SOLID_METRIC.test(m.name));
    if (metrics.length === 0) return;
    if (this.observer === undefined) {
      this.paint(metrics, event, undefined);
      return;
    }
    // Often already in the timeline by the time the caller has its answer.
    if (typeof performance.getEntriesByName === "function") {
      const entry = findResource(performance.getEntriesByName(response.url, "resource"), event);
      if (entry !== undefined) {
        this.paint(metrics, event, entry);
        return;
      }
    }
    this.pending.push({
      event,
      url: response.url,
      metrics,
      expires: performance.now() + PENDING_MS
    });
  }

  /** Resource entries as the observer delivers them: place the calls waiting for them. */
  private resources(entries: PerformanceEntryList): void {
    const pending = this.pending;
    if (pending.length === 0) return;
    const now = performance.now();
    for (let i = pending.length - 1; i >= 0; i--) {
      const call = pending[i];
      if (call.expires <= now) {
        pending.splice(i, 1);
        continue;
      }
      const entry = findResource(
        entries.filter(e => e.name === call.url),
        call.event
      );
      if (entry === undefined) continue;
      pending.splice(i, 1);
      this.paint(call.metrics, call.event, entry);
    }
  }

  /**
   * The document: `solid-shell` ends where the response head arrived
   * (`responseStart`); its boundaries settled at or before the flush — the
   * last one is what released the shell, the others some unknown margin
   * earlier (the header carries durations, not offsets) — so they end
   * there too.
   */
  private navigation(): void {
    if (typeof performance.getEntriesByType !== "function") return;
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (nav === undefined || !Array.isArray(nav.serverTiming) || !(nav.responseStart > 0)) return;
    const end = nav.responseStart;
    const rich = this.emit.rich;
    for (const metric of nav.serverTiming) {
      if (!SOLID_METRIC.test(metric.name)) continue;
      const kind = metric.name.slice(6);
      // The boundary's `desc` is its owner path — ASCII ` > ` on the wire —
      // shown the way the Async track's `fallback` spans label the same
      // boundary on the client: from its nearest component, the full path
      // as a property.
      const path = kind === "boundary" ? metric.description.split(" > ") : undefined;
      const label =
        kind === "shell"
          ? "shell · server"
          : path !== undefined
            ? `boundary ${nearest(path).join(" › ")} · server`
            : `${metric.description} · server`;
      let properties: Properties | undefined;
      if (rich) {
        properties = [
          ["Duration", ms(metric.duration)],
          ["Source", "Server-Timing on the document"],
          [
            "Placement",
            kind === "shell"
              ? "ends at responseStart — the head left when the shell was ready"
              : "ends with the shell — settled at or before the flush"
          ]
        ];
        if (path !== undefined && nearest(path).length !== path.length)
          properties.push(["Owner path", path.join(" › ")]);
      }
      this.emit.span(
        label,
        end - metric.duration,
        end,
        TRACKS.server,
        kind === "shell" ? "tertiary" : "tertiary-light",
        undefined,
        properties
      );
    }
  }

  /** The server spans of one call, placed by its resource entry when there is one. */
  private paint(
    metrics: ServerMetric[],
    event: CallEvent,
    entry: PerformanceResourceTiming | undefined
  ): void {
    const rich = this.emit.rich;
    // `responseStart` is `0` when timing is withheld (a cross-origin fetch
    // without `Timing-Allow-Origin`): the entry places nothing then.
    const end = entry !== undefined && entry.responseStart > 0 ? entry.responseStart : undefined;
    const mid = event.at + event.durationMs / 2;
    for (const metric of metrics) {
      const start = end !== undefined ? end - metric.duration : mid - metric.duration / 2;
      const stop = end !== undefined ? end : mid + metric.duration / 2;
      const label = `${metric.description || event.id} · server`;
      let properties: Properties | undefined;
      if (rich) {
        properties = [
          ["Duration", ms(metric.duration)],
          ["Wire", ms(Math.max(0, event.durationMs - metric.duration))],
          ["Source", "Server-Timing"],
          [
            "Placement",
            end !== undefined
              ? "ends at the response's responseStart"
              : "centred in the call — no resource timing for this fetch"
          ]
        ];
      }
      this.emit.span(label, start, stop, TRACKS.server, "tertiary", undefined, properties);
    }
  }
}

/** The fetch's resource entry: same URL, started inside the call. */
function findResource(
  entries: PerformanceEntryList,
  event: CallEvent
): PerformanceResourceTiming | undefined {
  const from = event.at - 1;
  const to = event.at + event.durationMs + 1;
  for (const entry of entries) {
    if (entry.startTime >= from && entry.startTime <= to) {
      return entry as PerformanceResourceTiming;
    }
  }
  return undefined;
}

/**
 * `Server-Timing` (RFC 9110 list): `name;dur=12.3;desc="x"`, entries split
 * on the commas outside quoted strings, `desc` unescaped. Entries without a
 * `dur` are the trace's (`traceparent;desc=…`) and are not spans.
 */
function parseServerTiming(value: string): ServerMetric[] {
  const out: ServerMetric[] = [];
  let start = 0;
  let quoted = false;
  const take = (end: number) => {
    const entry = value.slice(start, end).trim();
    if (entry === "") return;
    const parts = splitParams(entry);
    const name = parts[0].trim().toLowerCase();
    if (name === "") return;
    let duration: number | undefined;
    let description = "";
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf("=");
      if (eq === -1) continue;
      const key = parts[i].slice(0, eq).trim().toLowerCase();
      const raw = parts[i].slice(eq + 1).trim();
      if (key === "dur") duration = Number(raw);
      else if (key === "desc") description = unquote(raw);
    }
    if (duration === undefined || !(duration >= 0)) return;
    out.push({ name, duration, description });
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      take(i);
      start = i + 1;
    }
  }
  take(value.length);
  return out;
}

/** One metric's `;`-separated params, semicolons inside quotes kept. */
function splitParams(entry: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < entry.length; i++) {
    const c = entry[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ";") {
      parts.push(entry.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(entry.slice(start));
  return parts;
}

function unquote(raw: string): string {
  if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
    return raw.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return raw;
}

function ms(value: number): string {
  return `${value.toFixed(2)}ms`;
}

/** The root of a cause chain, as one line: `signal "count" write 0 → 1 — click on button#next`. */
function rootCause(cause: ChangeRecord, scrub: boolean): string {
  let root = cause;
  while (root.causes !== undefined && root.causes.length > 0) root = root.causes[0];
  let out = `${root.kind === "derived" ? "memo" : "signal"} "${root.name}" ${root.kind}`;
  if (!scrub && root.prev !== undefined) out += ` ${root.prev} → ${root.value}`;
  if (root.origin !== undefined && root.origin.kind !== "external")
    out += ` — ${formatOrigin(scrub ? scrubOrigin(root.origin) : root.origin)}`;
  return out;
}

function heldWrite(write: HeldWrite, scrub: boolean): string {
  return scrub || write.prev === undefined
    ? write.name
    : `${write.name} ${write.prev} → ${write.value}`;
}

// --- Scrubbing -----------------------------------------------------------------
//
// A trace recorded in production may be shared. The posture: no value
// previews (a signal's `prev`/`value` is application data), and no element
// text except on a `button` or `a` (what the user pressed is the point of
// an interaction record; the text of a `div` they clicked is content).

const TARGET_TEXT = /^(\w+)((?:#[^\s"]+|\[name=[^\]]+\])?) "(.*)"$/;

function scrubTarget(target: string | undefined): string | undefined {
  if (target === undefined) return undefined;
  const m = TARGET_TEXT.exec(target);
  if (m === null) return target;
  return m[1] === "button" || m[1] === "a" ? target : m[1] + m[2];
}

function scrubOrigin(origin: ChangeOrigin): ChangeOrigin {
  if (origin.target === undefined) return origin;
  const target = scrubTarget(origin.target);
  return target === origin.target ? origin : { ...origin, target };
}

function scrubCause(cause: ChangeRecord): ChangeRecord {
  const out: ChangeRecord = { ...cause };
  delete out.prev;
  delete out.value;
  if (out.origin !== undefined) out.origin = scrubOrigin(out.origin);
  if (out.causes !== undefined) out.causes = out.causes.map(scrubCause);
  return out;
}

function scrubRerun(event: RerunEvent): RerunEvent {
  return { ...event, causes: event.causes.map(scrubCause) };
}
