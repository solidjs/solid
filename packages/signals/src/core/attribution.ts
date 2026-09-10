import {
  setAttributionHooks,
  type AttributionHooks,
  type InteractionRef,
  type OriginRef
} from "./attribution-hooks.js";
import { $REFRESH, NOT_PENDING } from "./constants.js";
import {
  anyExcluded,
  emitDiagnostic,
  GRAPH_SIZE_WARN_AT,
  isExcluded,
  isSuppressed,
  ownerPath,
  reportDiagnostic
} from "./dev.js";
import type { Transition } from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

/**
 * "Why did this run" attribution — the engine behind
 * `@solidjs/signals/attribution`.
 *
 * The runtime already knows the full dependency set of every scope; this
 * module surfaces it. Every value commit stamps its node with a ChangeRecord
 * (a write, an async landing, a refresh() invalidation, or a derived change
 * whose `causes` chain back to root writes). When a computation re-executes,
 * the deps whose stamp is newer than the node's last run are its causes, so
 * each re-run can be explained as a chain down to the originating write:
 *
 *   [why-run] effect "docTitle" ran (run 4)
 *     ← memo "userLabel" changed (#6)
 *       ← signal "notifications" write (#5) 2 → 3
 *
 * This module is the attribution ENGINE: all semantics live here, and it is
 * decoupled from the core. `enable()` installs it into the core's narrow
 * observe-tier hook points (attribution-hooks.ts); core's only obligation is
 * to call those hooks with true facts. Disabled cost is one null check per
 * hook site; prod builds fold the sites out entirely. Nothing in the core
 * imports this module — it is reachable only through the package's
 * `./attribution` entry, so an observe build that never imports it never
 * ships it. The same hook surface is the intended substrate for external
 * consumers (devtools) — one mechanism, two front-ends.
 */

export type ChangeKind = "write" | "derived" | "async" | "refresh";

/**
 * Provenance of a root change: the imperative frame that performed it.
 *
 * - `interaction` — a user event handler (the web runtime marks dispatch via
 *   `withInteraction`). `name` is the event type, `target` the element hit
 *   (`button#next "Next →"`), `at` the dispatch time on the `performance.now()`
 *   clock — the base every feedback-latency number is measured from.
 * - `effect` — an effect callback (`name` = the effect's name; `run` = the
 *   compute run whose effect phase performed the write, when that run was
 *   recorded — so a write can be joined to the re-run that produced it).
 * - `action` — a step of an `action()` generator (`name` = the generator's
 *   name, when it has one). Writes after an `await` (not a `yield`) run in a
 *   bare microtask and stamp `external` — the documented escape.
 * - `async` — an async landing (`name` = the node whose flight landed).
 * - `navigation` — a router's navigation, declared via `withOrigin` around
 *   the location write (`name` = the matched route pattern `/users/:id`;
 *   `to`/`from` the concrete paths; `params` what the pattern bound; `at`
 *   when it was requested). The router-agnostic seam: any router that wraps
 *   its write gets navigations named by route in every hold, re-run and
 *   verdict, with no per-router knowledge anywhere in the engine.
 * - `external` — none of the above: timers, sockets, promise callbacks, setup.
 *
 * `interaction` on a non-interaction frame is the user event the frame runs
 * under — an action started by a click, an effect whose run was caused by a
 * click's write, a landing whose flight a click started, a navigation a link
 * click performed. It is what lets every downstream cost be keyed by the
 * interaction that paid for it.
 */
export interface ChangeOrigin {
  kind: "interaction" | "effect" | "action" | "async" | "navigation" | "external";
  name?: string;
  target?: string;
  at?: number;
  interaction?: ChangeOrigin;
  /** `effect` only: the `RerunEvent.run` of the compute run this callback belongs to. */
  run?: number;
  /** `navigation` only: concrete destination and departure paths, and the bound params. */
  to?: string;
  from?: string;
  params?: Readonly<Record<string, string | undefined>>;
}

export interface ChangeRecord {
  /** Global monotonic change sequence — orders causes across the app. */
  seq: number;
  kind: ChangeKind;
  name: string;
  /** Short previews of the value transition (writes only). */
  prev?: string;
  value?: string;
  /** First user frames of the triggering write's stack (opt-in). */
  stack?: string[];
  /** For derived changes: the upstream changes that produced this one. */
  causes?: ChangeRecord[];
  /** Root changes only: who performed the write. */
  origin?: ChangeOrigin;
  /** Root changes only: when the write was stamped (`performance.now()` clock). */
  at?: number;
}

export interface RerunEvent {
  /** Global monotonic run sequence. */
  run: number;
  /** When the run started (`performance.now()` clock). */
  at: number;
  /** How many times this node has re-run since attribution was enabled. */
  nodeRuns: number;
  nodeKind: "effect" | "memo";
  nodeName: string;
  node: Computed<any>;
  /**
   * The deps that changed since this node's previous run. Empty means the
   * re-run was not triggered by a tracked value change (creation-adjacent
   * pull, error retry, or a cause this prototype does not stamp yet).
   */
  causes: ChangeRecord[];
  /** Dependency count after this run. */
  depCount: number;
  /** Names of deps this run subscribed to that the previous run did not. */
  depsAdded: string[];
  /** Names of deps the previous run had that this run dropped. */
  depsRemoved: string[];
  /** Wall time of this run excluding nested recomputes (ms). */
  selfMs: number;
  /** Wall time of this run including nested recomputes (ms). */
  totalMs: number;
  /**
   * Whether the run produced a changed value. A PLAIN memo run with
   * `changed: false` was pure waste — the equality cutoff stopped it from
   * notifying anyone. Effects run with `_equals: false` in core (their
   * effect phase re-fires on every recompute), so the engine derives this
   * fact itself: an effect run whose compute output is identical to the
   * previous run's reports `changed: false` — the phase re-fired with the
   * same input, pure waste. Side-effect-only computes (`undefined` output)
   * are exempt: identity of `undefined` proves nothing about their work.
   * Summed as `wastedMs` in costs() (plain, non-held runs only — see
   * `phase`).
   */
  changed: boolean;
  /**
   * Which posture this run executed under. "optimistic" = under an
   * optimistic lane (overlay recompute); "held" = a hold was open or owns
   * the node (the run may be replayed/settled later); "plain" = an ordinary
   * committed run. Overlay runs are real work (they count toward time
   * budgets) but are never blamed as waste, and costs() reports their time
   * separately as `overlayMs`.
   */
  phase: "plain" | "held" | "optimistic";
  /**
   * The changed value was parked in `_pendingValue` (held) rather than
   * committed directly; its reveal happens on the hold's own schedule. Held
   * runs are excluded from waste accounting.
   */
  held: boolean;
  /** The user interaction this run traces back to through its causes, if any. */
  interaction?: ChangeOrigin;
}

export interface AttributionOptions {
  /** Pretty-print each re-run to the console (default true). */
  log?: boolean;
  /** Capture the user stack frame of each write — slow (default false). */
  stacks?: boolean;
  /** Ring-buffer size for `history()` (default 200). */
  historyLimit?: number;
  /**
   * Hot-scope warning: emit a diagnostic when one scope re-runs `count`
   * times within `windowMs` (default 120 runs / 1000ms — deliberately above
   * animation-frame cadence, so a legitimate rAF-driven scope at 60/s does
   * not cry wolf). `false` disables.
   */
  hotRuns?: { count: number; windowMs: number } | false;
  /**
   * Wide-scope warning: emit a diagnostic when a scope's dependency count
   * reaches this (default 30) — the coarse-read / helper-leak signature.
   * Re-warns only if the count then grows by another 50%. `false` disables.
   */
  wideDeps?: number | false;
  /**
   * Time-budget warning: emit a diagnostic when one scope's summed self-time
   * inside `windowMs` exceeds `budgetMs` (default 8ms / 1000ms — half a frame
   * spent in one scope). Unlike `hotRuns` this catches the few-but-expensive
   * scope that run counts miss. `false` disables.
   */
  hotTime?: { budgetMs: number; windowMs: number } | false;
  /**
   * Unstable-output warning: emit a diagnostic when a memo commits a
   * referentially-new but shallowly-equivalent plain object/array on this
   * many consecutive runs (default 4). Such a memo's equality gate never
   * closes — every subscriber re-runs on every upstream change — which makes
   * it a fan-out amplifier that is otherwise only findable by profiling.
   * `false` disables.
   */
  unstableMemos?: number | false;
  /**
   * Written-fan-out warning: emit a diagnostic when a committed root
   * invalidation (write, refresh, async landing) reaches a node with at
   * least this many subscribers (default 250). The lower-bar, opt-in sibling
   * of the always-on HUGE_FAN_OUT graph-size warning, which fires on the
   * same kind of write from GRAPH_SIZE_WARN_AT (2000) up; this one hands
   * over to it there, so a write never carries both. Once per node,
   * re-warning only on 2x subscriber growth. `false` disables.
   */
  wideWrites?: number | false;
  /**
   * Async-waterfall warning: emit a diagnostic when an async flight that
   * could only start after an upstream flight resolved (its recompute's
   * cause chain reaches the upstream's async landing, and its origin
   * post-dates that landing) forms a sequential chain of 2+ flights, each
   * of which took at least `minFlightMs` (default 50ms). The duration gate
   * is one safety valve for what the graph cannot see: a settled
   * preload/cache hit resolves fast and never warns. In-flight preloads are
   * absolved by origin: `markFlight()` stamps (and first-seen identity)
   * prove work predated the upstream landing — parallel, not sequential.
   * Chains of 2 emit at `info` severity, structured channel only (a
   * dependent fetch is sometimes intrinsic, and unmarked external preloads
   * are invisible); 3+ escalate to `warn` with console output. `false`
   * disables.
   */
  waterfalls?: { minFlightMs: number } | false;
  /**
   * Silent-hold warning: emit a diagnostic when a user's writes were held
   * behind async work for at least `infoMs` (default 100ms — RAIL's "feels
   * instant" ceiling) and the screen never acknowledged the wait — no
   * `isPending()`/`latest()` reader downstream of the held writes or their
   * blockers, no optimistic value, no `affects()` mark, and no lane effect
   * painted while held. Below `warnMs`
   * (default 200ms — the INP "good" ceiling) the event is advisory
   * (structured channel only); at or above it the console gets the finding.
   * The engine measures to the commit, not the paint, so every number is a
   * floor on what the user saw; the thresholds sit at the strict end of the
   * band on purpose. Holds that staged no root write (initial loads, bare
   * `refresh()`) are never judged: nothing the user did went unanswered.
   * `false` disables hold tracking altogether (`longHolds` included).
   */
  holds?: { infoMs: number; warnMs: number } | false;
  /**
   * Long-hold warning: emit a diagnostic when a hold's quiescent tail — the
   * time from the LAST write to join it until it committed — reached
   * `infoMs` (default 500ms), `warn` from `warnMs` (default 1000ms, where
   * RAIL says the user loses the thread). Measured from the last join so a
   * hold that keeps taking input (typing) is judged by each wait, not by its
   * lifetime. A hold this long is past what a stale screen should carry,
   * acknowledged or not: the honest UI is a fallback, which a `Loading`
   * boundary gives only when it has not revealed yet or its `on` prop
   * changed. Reported as LONG_HOLD when the hold was acknowledged; a silent
   * long hold stays one SILENT_HOLD with the boundary repair appended.
   * `false` disables.
   */
  longHolds?: { infoMs: number; warnMs: number } | false;
}

interface AttributedNode {
  _devChange?: ChangeRecord;
  _devSeenSeq?: number;
  _devRunCount?: number;
  _devWinStart?: number;
  _devWinCount?: number;
  _devHotWarned?: boolean;
  _devWideWarnedAt?: number;
  _devTimeWinStart?: number;
  _devTimeWinMs?: number;
  _devTimeWarned?: boolean;
  _devUnstableRuns?: number;
  _devUnstableWarned?: boolean;
  _devWideWriteWarnedAt?: number;
  /** Longest sequential-flight chain already warned for this node. */
  _devWaterfallWarnedAt?: number;
  /** Interaction the node's latest compute run traced to — inherited by its effect phase. */
  _devRunInteraction?: ChangeOrigin;
  /** Sequence and causes of the node's latest recorded run (undefined after a create run). */
  _devRunSeq?: number;
  _devRunCauses?: ChangeRecord[];
  /** Writers of this signal: undefined = none yet, 0 = non-effect, n = effect devId, null = mixed. */
  _devSoleWriter?: number | null;
  /** Consecutive effect-phase writes that copied the writing effect's compute output. */
  _devCopyRuns?: number;
  _devCopyFrom?: number;
  /** Cached `OBSERVE.isExcluded` verdict — owners never move, so it holds for the node's life. */
  _devExcluded?: boolean;
}

/**
 * Under an owner the observer marked as its own (`OBSERVE.exclude`): the
 * engine records nothing about the node. Cached per node once any exclusion
 * exists; before that the answer is a flag read.
 */
function excludedNode(el: Computed<any>): boolean {
  if (!anyExcluded()) return false;
  const node = el as AttributedNode;
  if (node._devExcluded === undefined) node._devExcluded = isExcluded(el);
  return node._devExcluded;
}

let attributionActive = false;

let changeSeq = 0;
let runSeq = 0;
const defaultOptions = {
  log: true,
  stacks: false,
  historyLimit: 200,
  hotRuns: { count: 120, windowMs: 1000 } as { count: number; windowMs: number } | false,
  wideDeps: 30 as number | false,
  hotTime: { budgetMs: 8, windowMs: 1000 } as { budgetMs: number; windowMs: number } | false,
  unstableMemos: 4 as number | false,
  wideWrites: 250 as number | false,
  waterfalls: { minFlightMs: 50 } as { minFlightMs: number } | false,
  holds: { infoMs: 100, warnMs: 200 } as { infoMs: number; warnMs: number } | false,
  longHolds: { infoMs: 500, warnMs: 1000 } as { infoMs: number; warnMs: number } | false
};
let options: typeof defaultOptions = { ...defaultOptions };
let history: RerunEvent[] = [];

/**
 * The records the engine delivers, by `subscribe(type, …)` name. Every one is
 * delivered synchronously at the moment it is complete — a re-run when its
 * recompute ends, an interaction / hold / navigation when it settles — so a
 * consumer never polls the ring buffers to learn that something finished.
 */
export interface AttributionRecords {
  rerun: RerunEvent;
  interaction: InteractionEvent;
  hold: HoldEvent;
  navigation: NavigationEvent;
}
export type AttributionRecordType = keyof AttributionRecords;
type RecordListeners = {
  [K in AttributionRecordType]: Set<(record: AttributionRecords[K]) => void>;
};
const recordListeners: RecordListeners = {
  rerun: new Set(),
  interaction: new Set(),
  hold: new Set(),
  navigation: new Set()
};
function emitRecord<K extends AttributionRecordType>(type: K, record: AttributionRecords[K]): void {
  for (const listener of recordListeners[type]) listener(record);
}
function clearListeners(): void {
  for (const type in recordListeners) recordListeners[type as AttributionRecordType].clear();
}

const now: () => number =
  typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

// Per-recompute frames: recomputes nest (pulls, child creation inside a
// parent's fn), so each frame carries the causes/prev-deps snapshot from
// recomputeStart plus the time its children consumed — the parent subtracts
// child time for honest self-time, the same discipline every profiler uses.
interface RunFrame {
  start: number;
  childMs: number;
  causes: ChangeRecord[] | null; // null on create runs
  prevDeps: unknown[] | null;
  /** Committed value before this run — baseline for the unstable-output check. */
  prevValue: unknown;
  /**
   * The interaction this run works for: traced through `causes` for a re-run;
   * inherited from the run (or effect callback) building it for a create run,
   * which has no causes of its own.
   */
  interaction: ChangeOrigin | undefined;
}
const frames: RunFrame[] = [];

// Cost aggregates, reset on enable()/disable().
export interface ScopeCost {
  name: string;
  kind: "effect" | "memo";
  runs: number;
  selfMs: number;
  /**
   * Self-time of PLAIN, non-held runs that produced an unchanged value —
   * the recoverable number. Overlay runs (optimistic/transition) are never
   * counted here: an optimistic recompute landing back on the committed
   * value is the mechanism working, not waste.
   */
  wastedMs: number;
  /** Self-time spent in optimistic/transition (overlay) runs. */
  overlayMs: number;
}
export interface WriteCost {
  /** Root cause name (a signal write, async landing, or refresh target). */
  name: string;
  /** Number of downstream re-runs this root triggered. */
  runs: number;
  /** Summed self-time of every downstream re-run it caused. */
  downstreamMs: number;
}
const scopeCosts = new Map<Computed<any>, ScopeCost>();
const writeCosts = new Map<string, WriteCost>();

function rootsOf(causes: ChangeRecord[], out: Set<string>): void {
  for (const c of causes) {
    if (c.kind === "derived" && c.causes && c.causes.length > 0) rootsOf(c.causes, out);
    else out.add(c.name);
  }
}

function recordCosts(event: RerunEvent): void {
  let scope = scopeCosts.get(event.node);
  if (scope === undefined) {
    scope = {
      name: event.nodeName,
      kind: event.nodeKind,
      runs: 0,
      selfMs: 0,
      wastedMs: 0,
      overlayMs: 0
    };
    scopeCosts.set(event.node, scope);
  }
  scope.runs++;
  scope.selfMs += event.selfMs;
  if (event.phase !== "plain") scope.overlayMs += event.selfMs;
  else if (!event.changed && !event.held) scope.wastedMs += event.selfMs;
  const roots = new Set<string>();
  rootsOf(event.causes, roots);
  for (const name of roots) {
    let write = writeCosts.get(name);
    if (write === undefined) writeCosts.set(name, (write = { name, runs: 0, downstreamMs: 0 }));
    write.runs++;
    write.downstreamMs += event.selfMs;
  }
}

function nodeName(node: Signal<any> | Computed<any>): string {
  return (node as AttributedNode & { _name?: string })._name ?? "anonymous";
}

function preview(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "undefined":
      return "undefined";
    case "string":
      return JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v);
    case "number":
    case "boolean":
    case "bigint":
      return String(v);
    case "function":
      return "[function]";
    case "symbol":
      return v.toString();
    default:
      return Array.isArray(v) ? `Array(${v.length})` : `[${v.constructor?.name ?? "object"}]`;
  }
}

function captureStack(): string[] | undefined {
  if (!options.stacks) return undefined;
  const raw = new Error().stack?.split("\n") ?? [];
  // Drop the message line and every frame inside the reactive core; the first
  // remaining frames are the user code that performed the write.
  return raw
    .slice(1)
    .filter(line => !/(?:^|[/\\])(?:packages[/\\])?signals[/\\](src|dist)[/\\]/.test(line))
    .slice(0, 3)
    .map(line => line.trim());
}

/** Sentinel for "no value transition to record" (refresh() stamps). */
const NO_VALUES = Symbol("no-values");

// --- Provenance -------------------------------------------------------------
//
// Who performed a write is not a graph fact — the graph only sees the write.
// The engine keeps an ambient answer: a stack of imperative frames the core
// announces (effect callbacks, action steps) and the interaction the web
// runtime declares around event dispatch. A write stamps the innermost frame;
// frames nested under an interaction carry it. Effects run in a later flush
// than the click that caused them, so their frame inherits the interaction
// from the run's cause chain instead (recorded at recomputeEnd).

const EXTERNAL_ORIGIN: ChangeOrigin = { kind: "external" };
const originFrames: ChangeOrigin[] = [];
/** Per action invocation (keyed by its iterator): the interaction its first step ran under. */
const actionInteractions = new WeakMap<object, ChangeOrigin | undefined>();
/**
 * The interaction frame the core's `withInteraction` opened (via the
 * `interactionStart`/`interactionEnd` hooks) for the duration of a handler.
 * Frames nest strictly, so the enclosing one is kept on a stack to restore.
 * The core pins the engine per frame: an `interactionEnd` can arrive after
 * `disable()` cleared the stack, so popping an empty stack is tolerated.
 */
let currentInteraction: ChangeOrigin | null = null;
const interactionStack: (ChangeOrigin | null)[] = [];

function interactionStart(ref: InteractionRef): void {
  interactionStack.push(currentInteraction);
  const origin: ChangeOrigin = { kind: "interaction", name: ref.type, at: ref.at ?? now() };
  if (ref.target) origin.target = ref.target;
  currentInteraction = origin;
  openInteraction(origin);
}

function interactionEnd(): void {
  const closing = currentInteraction;
  currentInteraction = interactionStack.length ? interactionStack.pop()! : null;
  if (closing !== null) closeInteraction(closing);
}

/** The interaction an origin runs under (itself, when it is one). */
function interactionOf(origin: ChangeOrigin | undefined): ChangeOrigin | undefined {
  if (origin === undefined) return undefined;
  return origin.kind === "interaction" ? origin : origin.interaction;
}

/** The interaction a cause list traces back to — root writes only, derived links walked. */
function interactionIn(causes: ChangeRecord[]): ChangeOrigin | undefined {
  for (const c of causes) {
    const found =
      c.kind === "derived"
        ? c.causes !== undefined
          ? interactionIn(c.causes)
          : undefined
        : interactionOf(c.origin);
    if (found !== undefined) return found;
  }
  return undefined;
}

function currentOrigin(): ChangeOrigin {
  const frame = originFrames[originFrames.length - 1];
  if (frame !== undefined) return frame;
  return currentInteraction ?? EXTERNAL_ORIGIN;
}

/**
 * What the engine knows about an effect frame beyond its serializable face:
 * the node, and the causes of the run whose effect phase this is (undefined
 * for a create run). `ChangeRecord.origin` IS the frame object, so a write's
 * origin resolves back to this through the map — the hop the effect-cycle
 * walk needs (see checkEffectCycle).
 */
interface EffectFrameInfo {
  node: Computed<any>;
  causes: ChangeRecord[] | undefined;
}
const effectFrames = new WeakMap<ChangeOrigin, EffectFrameInfo>();

/** The interaction the innermost open frame runs under, else the ambient one. */
function enclosingInteraction(): ChangeOrigin | undefined {
  const top = originFrames[originFrames.length - 1];
  return (top !== undefined ? interactionOf(top) : undefined) ?? currentInteraction ?? undefined;
}

function pushFrame(
  kind: "effect" | "action",
  name: string | undefined,
  interaction?: ChangeOrigin,
  effect?: Computed<any>
) {
  const frame: ChangeOrigin = { kind };
  if (name) frame.name = name;
  const under = interaction ?? currentInteraction ?? undefined;
  if (under !== undefined) frame.interaction = under;
  if (effect !== undefined) {
    const node = effect as AttributedNode;
    if (node._devRunSeq !== undefined) frame.run = node._devRunSeq;
    effectFrames.set(frame, { node: effect, causes: node._devRunCauses });
  }
  originFrames.push(frame);
}

function popFrame(kind: "effect" | "action" | "navigation") {
  // Frames are strictly nested; a mismatch means enable() landed mid-frame
  // (the opener never pushed) — leave the stack alone rather than pop a stranger.
  const top = originFrames[originFrames.length - 1];
  if (top !== undefined && top.kind === kind) originFrames.pop();
}

/**
 * `withOrigin` opened a declared frame. The frame object IS the origin every
 * write inside stamps, and the key the navigation record hangs off (see
 * "Navigations" below), so a hold or re-run that later resolves a write's
 * origin lands on the same record. It runs under the interaction of the frame
 * it opened inside — a `navigate()` from an action step, whose ambient
 * interaction is long gone but whose frame remembers it — else the ambient
 * one (a link click's handler).
 */
function originStart(ref: OriginRef): void {
  // A redirect hop re-enters the pending navigation's frame — the same object,
  // so its writes stamp the same origin and replace the pending write without
  // superseding it (see "Navigations").
  if (ref.redirect !== undefined && ref.redirect > 0) {
    const pending = lastOpenNavigation();
    if (pending !== undefined) {
      redirectNavigation(pending, ref);
      originFrames.push(pending.event.origin);
      return;
    }
  }
  const frame: ChangeOrigin = { kind: ref.kind, at: ref.at ?? now() };
  if (ref.from !== undefined) frame.from = ref.from;
  const under = enclosingInteraction();
  if (under !== undefined) frame.interaction = under;
  originFrames.push(frame);
  openNavigation(frame, ref);
}

function originEnd(): void {
  const top = originFrames[originFrames.length - 1];
  popFrame("navigation");
  if (top !== undefined && top.kind === "navigation") closeNavigation(top);
}

/** `click on button#next "Next →"`, `effect "syncTitle"`, `action "save"`, `navigation to /users/:id`, … */
export function formatOrigin(origin: ChangeOrigin): string {
  switch (origin.kind) {
    case "interaction":
      return `${origin.name} on ${origin.target ?? "an element"}`;
    case "effect":
      return `effect${origin.name ? ` "${origin.name}"` : ""}`;
    case "action":
      return `action${origin.name ? ` "${origin.name}"` : ""}`;
    case "async":
      return `async landing${origin.name ? ` on "${origin.name}"` : ""}`;
    case "navigation": {
      // The route pattern is the name consumers group by; the concrete path
      // follows when it adds information, then the destinations a redirect
      // chain abandoned on the way.
      const name = origin.name ?? origin.to;
      if (name === undefined) return "navigation";
      const notes: string[] = [];
      if (origin.to !== undefined && origin.to !== name) notes.push(origin.to);
      const redirects = navStates.get(origin)?.event.redirects;
      if (redirects !== undefined)
        notes.push(
          `redirected from ${redirects.map(hop => hop.to ?? hop.name ?? "?").join(" → ")}`
        );
      return `navigation to ${name}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
    }
    default:
      return "outside the reactive system";
  }
}

/** Record a root change (setSignal / refresh / async landing) on the node. */
/** Live subscriber count, walked on demand — the core keeps no counter. */
function countSubscribers(node: Signal<any> | Computed<any>): number {
  let n = 0;
  for (let s = node._subs; s !== null; s = s._nextSub) n++;
  return n;
}

/**
 * Written-fan-out warning — the engine's lower-bar sibling of the always-on
 * HUGE_FAN_OUT (see dev.ts): a committed root invalidation reaching hundreds
 * of subscribers re-runs all of them this flush. Counts the subscriber list
 * itself (an engine-only walk, on the write; the core keeps no per-node
 * count — a live `_subCount` was a post-construction field that forked node
 * shapes). Once per node; re-warns only when the subscriber count has
 * doubled since the last warning. Stops at GRAPH_SIZE_WARN_AT, where
 * HUGE_FAN_OUT takes over, so the two never fire for the same write.
 */
function checkWideWrite(
  node: Signal<any> | Computed<any>,
  kind: Exclude<ChangeKind, "derived">
): void {
  const limit = options.wideWrites;
  if (typeof limit !== "number") return;
  const subs = countSubscribers(node);
  const attributed = node as AttributedNode;
  if (subs < limit || subs >= GRAPH_SIZE_WARN_AT) return;
  if (subs < (attributed._devWideWriteWarnedAt ?? 0) * 2) return;
  attributed._devWideWriteWarnedAt = subs;
  const verb =
    kind === "refresh" ? "refresh of" : kind === "async" ? "async landing on" : "write to";
  const message =
    `[WIDE_WRITE] ${verb} "${nodeName(node)}" reached ${subs} subscribers — every one ` +
    `re-runs this flush. If consumers ask keyed questions of this value (for example every ` +
    `row comparing against one selected id), invert it: keep the answer in a store used as a ` +
    `map keyed by id, so each consumer reads its own key and only the keys that flipped update.`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "WIDE_WRITE",
        kind: "perf",
        severity: "warn",
        message,
        nodeName: nodeName(node),
        data: { subscribers: subs, write: kind }
      },
      node
    )
  );
}

function stampWrite(
  node: Signal<any> | Computed<any>,
  kind: Exclude<ChangeKind, "derived">,
  prev: unknown = NO_VALUES,
  value: unknown = NO_VALUES
): void {
  const record: ChangeRecord = { seq: ++changeSeq, kind, name: nodeName(node) };
  if (value !== NO_VALUES) {
    record.prev = prev === NO_VALUES ? undefined : preview(prev);
    record.value = preview(value);
  }
  record.origin = kind === "async" ? asyncOrigin(node as Computed<any>) : currentOrigin();
  record.at = now();
  record.stack = captureStack();
  const prior = (node as AttributedNode)._devChange;
  (node as AttributedNode)._devChange = record;
  noteNavigationWrite(prior, record);
  noteInteractionWrite(record.origin);
  if (kind === "write") trackEffectWrite(node, record, value);
  // stampWrite is the single funnel for committed root invalidations (sync
  // writes, refresh(), async landings), which makes it the one place the
  // written-fan-out check needs to live.
  checkWideWrite(node, kind);
}

/** Record a derived change (memo produced a new value) with its causes. */
function stampDerived(node: Computed<any>, causes: ChangeRecord[]): void {
  (node as AttributedNode)._devChange = {
    seq: ++changeSeq,
    kind: "derived",
    name: nodeName(node),
    causes
  };
}

/**
 * Collect the deps whose committed change is newer than this node's previous
 * run. Called at recompute entry, while `_deps` still holds the previous
 * run's links. A refresh() stamp on the node itself also counts — that is a
 * self-invalidation, not a dep change.
 */
function collectCauses(el: Computed<any>): ChangeRecord[] {
  const seen = (el as AttributedNode)._devSeenSeq ?? 0;
  const causes: ChangeRecord[] = [];
  const self = (el as AttributedNode)._devChange;
  if (self !== undefined && self.seq > seen && self.kind === "refresh") causes.push(self);
  for (let l = el._deps; l !== null; l = l._nextDep) {
    const change = (l._dep as AttributedNode)._devChange;
    if (change !== undefined && change.seq > seen) causes.push(change);
  }
  return causes;
}

/** Advance the node's seen-cursor to the present. Call after every run. */
function markSeen(el: Computed<any>): void {
  (el as AttributedNode)._devSeenSeq = changeSeq;
}

/** Snapshot the node's current dep identities (call before a run replaces them). */
function captureDeps(el: Computed<any>): unknown[] {
  const deps: unknown[] = [];
  for (let l = el._deps; l !== null; l = l._nextDep) deps.push(l._dep);
  return deps;
}

/**
 * Wide-scope warning — the coarse-read / helper-leak signature: one scope
 * subscribed to dozens of sources re-runs when ANY of them change. Fired from
 * recordRerun for re-runs and directly from recompute for creation runs (a
 * memo can be born too wide). Re-warns only on 50% further growth.
 */
function checkDepWidth(el: Computed<any>): void {
  const limit = options.wideDeps;
  if (limit === false) return;
  let count = 0;
  const names: string[] = [];
  for (let l = el._deps; l !== null; l = l._nextDep) {
    count++;
    if (names.length < 12) names.push(nodeName(l._dep));
  }
  const node = el as AttributedNode;
  if (count < limit || count < (node._devWideWarnedAt ?? 0) * 1.5) return;
  node._devWideWarnedAt = count;
  const kind = (el as { _type?: number })._type ? "effect" : "memo";
  const message =
    `[WIDE_SCOPE_DEPS] ${kind} "${nodeName(el)}" is subscribed to ${count} sources — ` +
    `it re-runs when any of them change. Narrow its reads or split it into smaller memos. ` +
    `Sources: ${names.join(", ")}${count > names.length ? ", …" : ""}`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "WIDE_SCOPE_DEPS",
        kind: "perf",
        severity: "warn",
        message,
        nodeName: nodeName(el),
        data: { depCount: count, deps: names }
      },
      el
    )
  );
}

/**
 * Per-cause aggregation for hot scopes. The per-node warning blames the
 * VICTIM; when one hot cause drives many scopes (a selection write fanning
 * out over every row, a timer leaking into a list), one culprit produces N
 * scope warnings — pure spam that buries the signal. So: the FIRST scope to
 * go hot for a given root-cause key warns normally (a genuinely single hot
 * scope keeps today's behavior exactly), subsequent scopes in the same
 * window are counted silently, and scope-count milestones (5, then 10x)
 * emit one escalating HOT_SCOPE_FANOUT naming the shared cause.
 */
interface HotCauseWindow {
  winStart: number;
  scopes: number;
  runs: number;
  nextMilestone: number;
}
const hotCauses = new Map<string, HotCauseWindow>();
const HOT_FANOUT_FIRST_MILESTONE = 5;

/**
 * Hot-scope warning — flags a scope that re-ran more than `count` times
 * inside one `windowMs` window. Warned once per window, with the most recent
 * cause chain named so the leaking signal is identified in the message.
 * Fan-out spam is folded per root cause (see HotCauseWindow above).
 */
function checkHotRuns(el: Computed<any>, event: RerunEvent): void {
  const cfg = options.hotRuns;
  if (cfg === false) return;
  const node = el as AttributedNode;
  const now = Date.now();
  if (node._devWinStart === undefined || now - node._devWinStart > cfg.windowMs) {
    node._devWinStart = now;
    node._devWinCount = 0;
    node._devHotWarned = false;
  }
  node._devWinCount = (node._devWinCount ?? 0) + 1;
  if (node._devHotWarned || node._devWinCount < cfg.count) return;
  node._devHotWarned = true;

  // Root-cause key: the set of originating writes behind this scope's latest
  // re-run. Scopes hot from the SAME roots share one aggregation window.
  const roots = new Set<string>();
  rootsOf(event.causes, roots);
  const causeKey = roots.size > 0 ? [...roots].sort().join(", ") : "(untracked)";
  let window = hotCauses.get(causeKey);
  if (window === undefined || now - window.winStart > cfg.windowMs) {
    window = { winStart: now, scopes: 0, runs: 0, nextMilestone: HOT_FANOUT_FIRST_MILESTONE };
    hotCauses.set(causeKey, window);
  }
  window.scopes++;
  window.runs += node._devWinCount;

  if (window.scopes === 1) {
    const rootCause = event.causes.map(c => `"${c.name}" (${c.kind})`).join(", ");
    const message =
      `[HOT_SCOPE_RERUNS] ${event.nodeKind} "${event.nodeName}" re-ran ${node._devWinCount} times ` +
      `in ${Math.max(1, now - node._devWinStart)}ms — a hot signal is likely leaking into this ` +
      `scope. Latest cause: ${rootCause || "(untracked pull)"}`;
    reportDiagnostic(
      emitDiagnostic(
        {
          code: "HOT_SCOPE_RERUNS",
          kind: "perf",
          severity: "warn",
          message,
          nodeName: event.nodeName,
          data: {
            runs: node._devWinCount,
            windowMs: cfg.windowMs,
            causes: event.causes.map(c => c.name)
          }
        },
        el
      )
    );
    return;
  }

  // Additional scopes hot from the same cause: silent until a milestone —
  // the culprit is the cause, and it has already been named once.
  if (window.scopes < window.nextMilestone) return;
  window.nextMilestone *= 10;
  const message =
    `[HOT_SCOPE_FANOUT] ${window.scopes} scopes have gone hot (${window.runs} re-runs) within ` +
    `${cfg.windowMs}ms, all driven by ${causeKey} — one hot cause is re-running a large part ` +
    `of the graph. Per-scope warnings are suppressed; fix the cause. If consumers ask keyed ` +
    `questions of it, invert it: a store used as a map keyed by id, one key per consumer.`;
  // The subject is the shared CAUSE, not this victim scope — no single owner
  // path locates it, so the event carries none.
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "HOT_SCOPE_FANOUT",
        kind: "perf",
        severity: "warn",
        message,
        nodeName: causeKey,
        data: { cause: causeKey, scopes: window.scopes, runs: window.runs, windowMs: cfg.windowMs }
      },
      null
    )
  );
}

/**
 * Time-budget warning — the counterpart of checkHotRuns for the
 * few-but-expensive scope: warns when one scope's summed self-time within a
 * window exceeds the budget. Warned once per window.
 */
function checkHotTime(el: Computed<any>, event: RerunEvent): void {
  const cfg = options.hotTime;
  if (cfg === false) return;
  const node = el as AttributedNode;
  const at = now();
  if (node._devTimeWinStart === undefined || at - node._devTimeWinStart > cfg.windowMs) {
    node._devTimeWinStart = at;
    node._devTimeWinMs = 0;
    node._devTimeWarned = false;
  }
  node._devTimeWinMs = (node._devTimeWinMs ?? 0) + event.selfMs;
  if (node._devTimeWarned || node._devTimeWinMs < cfg.budgetMs) return;
  node._devTimeWarned = true;
  const rootCause = event.causes.map(c => `"${c.name}" (${c.kind})`).join(", ");
  const message =
    `[HOT_SCOPE_TIME] ${event.nodeKind} "${event.nodeName}" spent ` +
    `${node._devTimeWinMs.toFixed(1)}ms of compute inside one ${cfg.windowMs}ms window ` +
    `(budget ${cfg.budgetMs}ms). Latest cause: ${rootCause || "(untracked pull)"}`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "HOT_SCOPE_TIME",
        kind: "perf",
        severity: "warn",
        message,
        nodeName: event.nodeName,
        data: {
          spentMs: node._devTimeWinMs,
          budgetMs: cfg.budgetMs,
          windowMs: cfg.windowMs,
          causes: event.causes.map(c => c.name)
        }
      },
      el
    )
  );
}

function recordRerun(
  el: Computed<any>,
  frame: RunFrame,
  timing: { selfMs: number; totalMs: number },
  changed: boolean,
  phase: "plain" | "held" | "optimistic",
  held: boolean
): void {
  const causes = frame.causes!;
  const prevDeps = frame.prevDeps!;
  const node = el as AttributedNode;
  const prevCauses = node._devRunCauses;
  if (excludedNode(el)) {
    // The observer's own computation: keep the per-node bookkeeping its
    // effect phase reads (see effectRunStart) and record nothing.
    node._devRunInteraction = frame.interaction;
    node._devRunSeq = undefined;
    node._devRunCauses = causes;
    return;
  }
  // Subscription diff: `prevDeps` was captured at run entry; `_deps` now
  // holds the fresh set. A changed set is the "helper edit changed distant
  // call sites" signal — surfaced per-event and in the console format.
  const newDeps = captureDeps(el);
  const prevSet = new Set(prevDeps);
  const newSet = new Set(newDeps);
  const depsAdded: string[] = [];
  const depsRemoved: string[] = [];
  for (const d of newDeps) if (!prevSet.has(d)) depsAdded.push(nodeName(d as Signal<any>));
  for (const d of prevDeps) if (!newSet.has(d)) depsRemoved.push(nodeName(d as Signal<any>));
  const event: RerunEvent = {
    run: ++runSeq,
    at: frame.start,
    nodeRuns: (node._devRunCount = (node._devRunCount ?? 0) + 1),
    nodeKind: (el as { _type?: number })._type ? "effect" : "memo",
    nodeName: nodeName(el),
    node: el,
    causes,
    depCount: newDeps.length,
    depsAdded,
    depsRemoved,
    selfMs: timing.selfMs,
    totalMs: timing.totalMs,
    changed,
    phase,
    held
  };
  const interaction = frame.interaction;
  if (interaction !== undefined) event.interaction = interaction;
  // The effect phase runs later in the flush with no cause list of its own:
  // it inherits this run's interaction and is joined to this run's causes
  // (see effectRunStart / pushFrame).
  node._devRunInteraction = interaction;
  node._devRunSeq = event.run;
  node._devRunCauses = causes;
  history.push(event);
  if (history.length > options.historyLimit) history.shift();
  recordCosts(event);
  recordFeedbackRun(event);
  noteInteractionRun(interaction, timing.selfMs, false);
  if (event.nodeKind === "effect") checkEffectCycle(el, causes);
  checkRelayTear(el, causes, prevCauses);
  checkHotRuns(el, event);
  checkHotTime(el, event);
  checkDepWidth(el);
  emitRecord("rerun", event);
  if (options.log) logRerun(event);
}

function formatCause(cause: ChangeRecord, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth + 1);
  let line = `${pad}← ${cause.kind === "derived" ? "memo" : "signal"} "${cause.name}" ${
    cause.kind === "derived" ? "changed" : cause.kind
  } (#${cause.seq})`;
  if (cause.prev !== undefined) line += ` ${cause.prev} → ${cause.value}`;
  if (cause.origin !== undefined && cause.origin.kind !== "external") {
    line += ` — ${formatOrigin(cause.origin)}`;
    const under = cause.origin.interaction;
    if (under !== undefined) line += ` (under ${formatOrigin(under)})`;
  }
  out.push(line);
  if (cause.stack) for (const frame of cause.stack) out.push(`${pad}    ${frame}`);
  if (cause.causes && depth < 10) {
    for (const upstream of cause.causes) formatCause(upstream, depth + 1, out);
  }
}

export function formatRerun(event: RerunEvent): string {
  const out = [
    `[why-run] ${event.nodeKind} "${event.nodeName}" ran (run ${event.nodeRuns}, ` +
      `${event.selfMs.toFixed(2)}ms${event.changed ? "" : ", unchanged"}` +
      `${event.phase === "plain" ? "" : `, ${event.phase}`}${event.held ? ", held" : ""})` +
      (event.causes.length === 0 ? " — no tracked cause (pull or retry)" : "")
  ];
  for (const cause of event.causes) formatCause(cause, 0, out);
  if (event.depsAdded.length > 0 || event.depsRemoved.length > 0) {
    const delta = [
      ...event.depsAdded.map(n => `+"${n}"`),
      ...event.depsRemoved.map(n => `-"${n}"`)
    ].join(" ");
    out.push(`  deps changed: ${delta} (${event.depCount} total)`);
  }
  return out.join("\n");
}

/**
 * Console face of a re-run: the headline as a collapsed group with the
 * why-chain and dep delta inside, so a busy console stays scannable (one line
 * per run, evidence a click away). Consoles without grouping get the text.
 */
function logRerun(event: RerunEvent): void {
  const text = formatRerun(event);
  const nl = text.indexOf("\n");
  if (nl === -1 || typeof console.groupCollapsed !== "function") {
    console.log(text);
    return;
  }
  console.groupCollapsed(text.slice(0, nl));
  console.log(text.slice(nl + 1));
  console.groupEnd();
}

export interface Attribution {
  enable(opts?: AttributionOptions): void;
  disable(): void;
  /**
   * Deliver records as they complete — see `AttributionRecords`. The bare
   * form is `subscribe("rerun", …)`. Records are the same objects the ring
   * buffers hold (`history()`, `interactions()`, `holds()`, `navigations()`),
   * delivered synchronously from the engine, so a listener must not write
   * signals. All subscriptions are dropped by `disable()`.
   */
  subscribe(listener: (event: RerunEvent) => void): () => void;
  subscribe<K extends AttributionRecordType>(
    type: K,
    listener: (record: AttributionRecords[K]) => void
  ): () => void;
  history(): readonly RerunEvent[];
  /** Re-run history for one node — pass a memo/effect accessor or raw node. */
  why(target: unknown): RerunEvent[];
  /** Current dependency names of one scope — the devtools subscription view. */
  subscriptions(target: unknown): string[];
  /**
   * Aggregated cost tables since enable(): `scopes` ranked by self-time
   * (with `wastedMs` = time spent on unchanged-value runs), `writes` ranked
   * by total downstream re-run time each root write caused.
   */
  costs(): { scopes: ScopeCost[]; writes: WriteCost[] };
  /**
   * Every graph-provable sequential flight chain observed since enable()
   * (ring-buffered like history()). Facts, not verdicts: chains are recorded
   * regardless of the duration gate — the ASYNC_WATERFALL diagnostic is the
   * thresholded view of the same data.
   */
  waterfalls(): readonly WaterfallRecord[];
  /**
   * Every settled transition hold that staged at least one root write since
   * enable() (ring-buffered like history()). Facts, not verdicts: recorded
   * regardless of duration or acknowledgment — the SILENT_HOLD diagnostic is
   * the thresholded, unacknowledged subset.
   */
  holds(): readonly HoldEvent[];
  /**
   * Every navigation a router declared via `withOrigin` since enable()
   * (ring-buffered like history()), settled or not: what route, under which
   * interaction, how many writes, and — once its writes are through — how
   * long that took and how (`committed` in a plain drain, `held` behind
   * route data with the HoldEvent attached, or `superseded` by a later
   * navigation before it landed). Facts for any consumer that wants
   * navigation spans named by route: no router integration needed.
   */
  navigations(): readonly NavigationEvent[];
  /**
   * Every user interaction a runtime declared via `withInteraction` since
   * enable() (ring-buffered like history()), settled or not: what was
   * dispatched, when, what it wrote, the re-runs and creations it caused,
   * the holds its writes waited in and the navigations it performed — and,
   * once all of that is through, how long the person waited (`settledMs`)
   * and how it ended (`idle` / `committed` / `held`). The per-dispatch
   * record `feedback().interactions` folds by name.
   */
  interactions(): readonly InteractionEvent[];
  /**
   * What the user waited on, folded from holds() and the interaction on each
   * re-run: `sources` ranks async sources by the silent time writes spent
   * held behind them (with which affordances answered, how often, and which
   * interactions were held); `interactions` ranks user events by the total
   * time they cost — re-run work caused (long-flush hazard) beside time held
   * (silent-hold hazard). Facts at every duration; SILENT_HOLD is the
   * thresholded verdict. Three more tables round out the picture:
   * `navigations` ranks routes by the time spent held navigating to them
   * (folded from navigations()), `flights` counts each async source's
   * flights and how many were abandoned before landing (the re-ask storm),
   * and `fallbacks` measures how long each loading boundary showed its
   * fallback and how often that was a flash.
   */
  feedback(): AttributionFeedbackTables;
  /**
   * Cooperative preload declaration: stamp a flight object (promise or async
   * iterable) with its true kickoff time BEFORE the reactive graph sees it.
   * A route preloader or query cache calls this on the promise it hands out
   * (on the WRAPPER it mints, with the original kickoff time — wrapping
   * defeats identity tracking otherwise); any dependent that later awaits it
   * is then judged against the real start — work already in the air when its
   * upstream landed is parallel, never a waterfall link. Callable while
   * attribution is disabled (marks made at navigation time must survive a
   * later enable()).
   */
  markFlight(flight: object, startedAt?: number): void;
  format: typeof formatRerun;
  formatOrigin: typeof formatOrigin;
}

/**
 * Values eligible for the unstable-output check: plain objects and arrays
 * only. Promises, iterators, Dates, Maps, class instances etc. all have no
 * (or unrepresentative) own enumerable keys, so a shallow compare would
 * false-positive on them — a fresh Promise is a genuinely new value.
 */
function isPlainShape(v: unknown): v is object {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Shallow structural equivalence, capped so hot paths stay cheap. */
const UNSTABLE_KEY_CAP = 64;
function shallowEquivalent(a: object, b: object): boolean {
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length || arrA.length > UNSTABLE_KEY_CAP) return false;
    for (let i = 0; i < arrA.length; i++) if (arrA[i] !== arrB[i]) return false;
    return true;
  }
  const keys = Object.keys(a);
  if (keys.length > UNSTABLE_KEY_CAP || keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!(key in b) || (a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key])
      return false;
  }
  return true;
}

/**
 * Unstable-output warning — the fan-out amplifier signature: a memo whose
 * committed value is referentially new but structurally identical run after
 * run has an equality gate that never closes, so ALL its subscribers re-run
 * on EVERY upstream change. Checked only on plain (non-overlay) changed runs;
 * a genuinely different value (or a non-plain shape) resets the streak.
 */
function checkUnstableOutput(el: Computed<any>, prevValue: unknown, newValue: unknown): void {
  const limit = options.unstableMemos;
  // typeof guard: an explicit `unstableMemos: undefined` in enable() options
  // clobbers the default through the spread — treat any non-number as off.
  if (typeof limit !== "number") return;
  const node = el as AttributedNode;
  if (
    prevValue === newValue || // paranoia: changed runs should never hit this
    !isPlainShape(prevValue) ||
    !isPlainShape(newValue) ||
    !shallowEquivalent(prevValue, newValue)
  ) {
    node._devUnstableRuns = 0;
    node._devUnstableWarned = false;
    return;
  }
  node._devUnstableRuns = (node._devUnstableRuns ?? 0) + 1;
  if (node._devUnstableWarned || node._devUnstableRuns < limit) return;
  node._devUnstableWarned = true;
  const shape = Array.isArray(newValue) ? "array" : "object";
  const message =
    `[UNSTABLE_MEMO_OUTPUT] memo "${nodeName(el)}" produced a new-but-equivalent ${shape} on ` +
    `${node._devUnstableRuns} consecutive runs — its equality gate never closes, so every ` +
    `subscriber re-runs on every upstream change. Return stable references or pass an ` +
    `\`equals\` option.`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "UNSTABLE_MEMO_OUTPUT",
        kind: "perf",
        severity: "warn",
        message,
        nodeName: nodeName(el),
        data: { runs: node._devUnstableRuns, shape }
      },
      el
    )
  );
}

// --- Effect write cycles --------------------------------------------------------
//
// An effect that writes a value its own inputs depend on converges rather than
// loops when the second run finds nothing left to change — so the flush guard
// never fires, and nothing tells the developer the effect ran twice and the
// screen rendered the pre-write value in between. The graph sees it exactly:
// the re-run's cause chain (root writes, walked through however many memos)
// contains a write whose origin is an effect frame, and the frame resolves to
// the effect that is now re-running. Cycles that span effects — E1 writes A,
// E2 reads A and writes B, E1 reads B — are the same walk one hop deeper: an
// effect-origin write resolves to the run that made it, whose causes resolve
// to the next write. The walk stops at any non-effect origin (a click, a
// timer, an async landing: a real outside cause), at a revisited effect, and
// at a depth cap. Causality through untracked indirection is not a graph edge
// and is not claimed.
//
// Reported once per cycle. A single-effect cycle warns — the repair is
// unambiguous: the written value is a function of what the effect reads, so
// it is a memo. Multi-effect cycles are advisory until real fixtures have
// shaped the message.

interface CycleLink {
  effect: Computed<any>;
  write: ChangeRecord;
}
const EFFECT_CYCLE_MAX_HOPS = 6;
const reportedCycles = new Set<string>();
let nextDevId = 0;
const devIds = new WeakMap<object, number>();
function devId(node: object): number {
  let id = devIds.get(node);
  if (id === undefined) devIds.set(node, (id = ++nextDevId));
  return id;
}

function rootWrites(causes: ChangeRecord[], out: ChangeRecord[]): void {
  for (const c of causes) {
    if (c.kind === "derived") {
      if (c.causes !== undefined) rootWrites(c.causes, out);
    } else out.push(c);
  }
}

/**
 * The effect writes leading from an earlier run of `target` to the run whose
 * `causes` these are, in causal order (target's own write first), or null.
 */
function findEffectCycle(
  target: Computed<any>,
  causes: ChangeRecord[],
  visited: Set<Computed<any>>,
  hops: number
): CycleLink[] | null {
  const roots: ChangeRecord[] = [];
  rootWrites(causes, roots);
  for (const write of roots) {
    const origin = write.origin;
    if (origin === undefined || origin.kind !== "effect") continue;
    const info = effectFrames.get(origin);
    if (info === undefined) continue;
    if (info.node === target) return [{ effect: info.node, write }];
    if (hops >= EFFECT_CYCLE_MAX_HOPS || visited.has(info.node) || info.causes === undefined)
      continue;
    visited.add(info.node);
    const rest = findEffectCycle(target, info.causes, visited, hops + 1);
    if (rest !== null) {
      rest.push({ effect: info.node, write });
      return rest;
    }
  }
  return null;
}

/** Names of the memos between a direct cause of a run and `write`, root-first. */
function derivedPath(causes: ChangeRecord[], write: ChangeRecord, path: string[]): boolean {
  for (const c of causes) {
    if (c === write) return true;
    if (c.kind === "derived" && c.causes !== undefined) {
      path.unshift(c.name);
      if (derivedPath(c.causes, write, path)) return true;
      path.shift();
    }
  }
  return false;
}

function describeWrite(write: ChangeRecord): string {
  if (write.kind === "refresh") return `refreshed "${write.name}"`;
  const values = write.prev !== undefined ? ` (${write.prev} → ${write.value})` : "";
  return `wrote "${write.name}"${values}`;
}

function checkEffectCycle(el: Computed<any>, causes: ChangeRecord[]): void {
  const links = findEffectCycle(el, causes, new Set([el]), 0);
  if (links === null) return;
  const key = links
    .map(link => devId(link.effect))
    .sort((a, b) => a - b)
    .join(",");
  if (reportedCycles.has(key)) return;
  reportedCycles.add(key);
  const flushes = links.length + 1;
  let message: string;
  if (links.length === 1) {
    const [{ write }] = links;
    const path: string[] = [];
    derivedPath(causes, write, path);
    const via = path.length > 0 ? ` through ${path.map(n => `memo "${n}"`).join(" → ")}` : "";
    message =
      `[EFFECT_WRITES_OWN_SOURCE] effect "${nodeName(el)}" re-ran because of its own write: it ` +
      `${describeWrite(write)}, which fed back into its inputs${via}. Two flushes to settle, ` +
      `and the screen rendered the pre-write value in between. The written value is a function ` +
      `of what the effect reads — compute it in a memo (or normalize where the source is ` +
      `written) instead of correcting it after the fact.`;
  } else {
    const names = links.map(link => `"${nodeName(link.effect)}"`);
    const steps = links
      .map(
        (link, i) => `effect ${names[i]}${i > 0 ? " re-ran and" : ""} ${describeWrite(link.write)}`
      )
      .join("; ");
    message =
      `[EFFECT_WRITES_OWN_SOURCE] effects ${[...names, names[0]].join(" → ")} relay writes in a ` +
      `cycle: ${steps}; which fed back into effect ${names[0]}'s inputs — ${flushes} flushes to ` +
      `settle after each change, each rendering an intermediate state. Every relayed value is a ` +
      `function of the original inputs: derive them in memos and drop the writes.`;
  }
  const severity = links.length === 1 ? "warn" : "info";
  const entry = emitDiagnostic(
    {
      code: "EFFECT_WRITES_OWN_SOURCE",
      kind: "perf",
      severity,
      message,
      nodeName: nodeName(el),
      data: {
        effects: links.map(link => nodeName(link.effect)),
        writes: links.map(link => ({
          effect: nodeName(link.effect),
          kind: link.write.kind,
          name: link.write.name,
          prev: link.write.prev,
          value: link.write.value
        })),
        flushes
      }
    },
    el
  );
  if (severity === "warn") reportDiagnostic(entry);
}

// --- Effect relay tears -------------------------------------------------------
//
// Derived state kept in sync by an effect — `createEffect(() => filter(a()),
// v => setS(v))` — is the React habit Solid does not need, but "should have
// been a memo" is a claim about intent the runtime cannot see. What it CAN
// see is the harm: every scope that reads both `a` and `S` runs twice for one
// write of `a` — once in the flush where `a` changed (against stale `S`), and
// again after the effect's write lands — and the first frame was
// inconsistent. That is a pure cause-chain fact: C's re-run has ONLY
// effect-origin root writes, and the run that made one of them was itself
// caused by a root write C already ran for. No guess about purity.
//
// The intent heuristics are then confidence modifiers on the message, not
// gates. Two are cheap and honest:
// - copy: the written value IS the effect's compute output (one `===` per
//   effect-phase write). By Solid's contract the compute half is a pure
//   function of its tracked reads, so the written value is derivable — a
//   memo — with no guess about the callback's purity. Near-certain, so it
//   warns on its own once it has repeated, even with no double-running
//   reader: everything reading the copy paints a flush behind everything
//   reading the source. The prop-to-state port is the special case where the
//   compute output is itself one of the effect's sources (`passthrough`):
//   read the source directly.
// - sole writer: every write to `S` in the session came from this effect.
//   Medium — real state grows other writers eventually — so it sharpens the
//   text, not the severity.
// A tear whose write is neither is `info` (a DOM-measurement effect tears
// legitimately: the cost of measuring) until the same relay has torn
// repeatedly, then `warn`.

interface RelayState {
  count: number;
  warned: boolean;
}
const RELAY_WARN_AT = 3;
const relays = new Map<string, RelayState>();
const copyWrites = new WeakSet<ChangeRecord>();
const copyReported = new WeakSet<object>();
/** The node each root write record was stamped on (records are serializable and cannot hold it). */
const recordNodes = new WeakMap<ChangeRecord, Signal<any> | Computed<any>>();

/**
 * Write-side bookkeeping for the relay heuristics: who has written this
 * signal, and whether an effect just copied its compute output into it.
 */
function trackEffectWrite(node: Signal<any> | Computed<any>, record: ChangeRecord, value: unknown) {
  const n = node as AttributedNode;
  const origin = record.origin;
  const info =
    origin !== undefined && origin.kind === "effect" ? effectFrames.get(origin) : undefined;
  const writer = info === undefined ? 0 : devId(info.node);
  recordNodes.set(record, node);
  n._devSoleWriter = n._devSoleWriter === undefined || n._devSoleWriter === writer ? writer : null;
  if (info !== undefined && value !== undefined && value === info.node._value) {
    copyWrites.add(record);
    n._devCopyRuns = n._devCopyFrom === writer ? (n._devCopyRuns ?? 0) + 1 : 1;
    n._devCopyFrom = writer;
    if (n._devCopyRuns >= 2 && n._devSoleWriter === writer) checkCopyEffect(info.node, node);
  } else n._devCopyRuns = 0;
}

/** The effect's source whose current value the compute output is, if any (the prop-to-state port). */
function passthroughSource(effect: Computed<any>): string | undefined {
  for (let l = effect._deps; l !== null; l = l._nextDep)
    if (l._dep._value === effect._value) return nodeName(l._dep);
  return undefined;
}

/** The repair for a write that is the effect's compute output. */
function copyRepair(effect: Computed<any>, target: string): string {
  const source = passthroughSource(effect);
  return source !== undefined
    ? `The written value is "${source}" itself: read "${source}" where "${target}" is read ` +
        `(or createMemo it if a stable derivation is needed) and delete the effect.`
    : `The written value is the effect's compute output — by contract a pure function of ` +
        `what it tracks: make "${target}" a memo of that computation and delete the effect.`;
}

function checkCopyEffect(effect: Computed<any>, target: Signal<any> | Computed<any>): void {
  if (copyReported.has(target)) return;
  copyReported.add(target);
  const name = nodeName(target);
  const message =
    `[EFFECT_RELAY_TEAR] effect "${nodeName(effect)}" writes its compute output into ` +
    `"${name}" on every run, and nothing else writes "${name}" — it is derived state kept ` +
    `one flush late: everything reading it paints a frame behind everything reading the ` +
    `source. ${copyRepair(effect, name)}`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "EFFECT_RELAY_TEAR",
        kind: "perf",
        severity: "warn",
        message,
        nodeName: nodeName(effect),
        data: {
          relay: nodeName(effect),
          wrote: name,
          copy: true,
          passthrough: passthroughSource(effect) ?? null,
          soleWriter: true
        }
      },
      effect
    )
  );
}

/**
 * `victim` re-ran with `causes`; its previous run had `prevCauses`. A tear is
 * a re-run whose root writes ALL came from effects (no independent outside
 * cause) and at least one of which was made by a run that shares a root
 * write with the victim's previous run.
 */
function checkRelayTear(
  victim: Computed<any>,
  causes: ChangeRecord[],
  prevCauses: ChangeRecord[] | undefined
): void {
  if (prevCauses === undefined || causes.length === 0) return;
  const roots: ChangeRecord[] = [];
  rootWrites(causes, roots);
  if (roots.length === 0) return;
  let relay: EffectFrameInfo | undefined;
  let write: ChangeRecord | undefined;
  let shared: ChangeRecord | undefined;
  for (const root of roots) {
    const origin = root.origin;
    if (origin === undefined || origin.kind !== "effect") return;
    const info = effectFrames.get(origin);
    // Own-source cycles are EFFECT_WRITES_OWN_SOURCE's; a create-run relay
    // is initial sync, not a tear for one change.
    if (info === undefined || info.node === victim || info.causes === undefined) return;
    if (shared === undefined) {
      const relayRoots: ChangeRecord[] = [];
      rootWrites(info.causes, relayRoots);
      const prevRoots: ChangeRecord[] = [];
      rootWrites(prevCauses, prevRoots);
      const hit = relayRoots.find(r => prevRoots.includes(r));
      if (hit !== undefined) {
        shared = hit;
        relay = info;
        write = root;
      }
    }
  }
  if (shared === undefined || relay === undefined || write === undefined) return;
  const key = `${devId(relay.node)}:${write.name}`;
  let state = relays.get(key);
  if (state === undefined) relays.set(key, (state = { count: 0, warned: false }));
  state.count++;
  const copy = copyWrites.has(write);
  const target = recordNodes.get(write) as AttributedNode | undefined;
  const soleWriter = target !== undefined && target._devSoleWriter === devId(relay.node);
  // Derivable outright: the value is the compute output and nothing else
  // writes the signal. A copy INTO a signal that has other writers is the
  // "reset editable state from a source" shape — the tear is real, but a memo
  // is not the answer, so it stays advisory like any other non-derivable tear.
  const derivable = copy && soleWriter;
  const severity = derivable || state.count >= RELAY_WARN_AT ? "warn" : "info";
  // First sighting always reports (advisory); afterwards only the escalation.
  if (state.count > 1 && (severity !== "warn" || state.warned)) return;
  // One verdict per derivable signal: the copy report (checkCopyEffect) and
  // the tear report carry the same repair.
  if (derivable && target !== undefined) {
    if (copyReported.has(target)) return;
    copyReported.add(target);
  }
  if (severity === "warn") state.warned = true;
  const victimKind = (victim as { _type?: number })._type ? "effect" : "memo";
  const relayName = nodeName(relay.node);
  const repair = derivable
    ? copyRepair(relay.node, write.name)
    : copy
      ? `The written value is the effect's compute output, but "${write.name}" has other ` +
        `writers — editable state reset from a source. If the reset is the intent, the tear ` +
        `is its cost; if "${write.name}" only ever mirrors the source, drop the local copy ` +
        `and read the source.`
      : soleWriter
        ? `Nothing else writes "${write.name}" — it is derived state: make it a memo over what ` +
          `the effect reads and every reader gets it in the same flush.`
        : `If "${write.name}" is computed from what the effect reads, make it a memo so readers ` +
          `get it in the same flush; if the write reads something outside the graph (layout, ` +
          `time), the tear is the cost of measuring.`;
  const message =
    `[EFFECT_RELAY_TEAR] ${victimKind} "${nodeName(victim)}" ran twice for one write of ` +
    `"${shared.name}": once in the flush where "${shared.name}" changed, and again after ` +
    `effect "${relayName}" relayed it by writing "${write.name}" — the first frame showed the ` +
    `new "${shared.name}" with the stale "${write.name}"` +
    (state.count > 1 ? ` (${state.count} times so far)` : "") +
    `. ${repair}`;
  const entry = emitDiagnostic(
    {
      code: "EFFECT_RELAY_TEAR",
      kind: "perf",
      severity,
      message,
      nodeName: nodeName(victim),
      data: {
        victim: nodeName(victim),
        root: shared.name,
        relay: relayName,
        wrote: write.name,
        copy,
        passthrough: copy ? (passthroughSource(relay.node) ?? null) : null,
        soleWriter,
        occurrences: state.count
      }
    },
    victim
  );
  if (severity === "warn") reportDiagnostic(entry);
}

// --- Immutable updates in stores ---------------------------------------------
//
// `draft.user = { ...draft.user, name }` / `draft.items = [...draft.items,
// x]` / `draft.items = draft.items.filter(...)` — the React habit of
// producing a fresh container to change one leaf. The store tracks leaves, so
// a fresh container is pure cost: every reader of `user` (any path below it)
// re-runs for the one leaf that moved, where a draft mutation would re-run
// only the readers of `name`. The store's notify sees both containers at the
// write and reports a leaf census (identity on unwrapped values, capped); the
// verdict is the whole detector: a replacement whose leaves are mostly the
// SAME values is a spread-copy, and one whose leaves are mostly different is
// new data (reconcile's job — and UNSTABLE_LIST_IDENTITY's, downstream). Once
// per store path.

const immutableReported = new Set<string>();

function checkImmutableUpdate(
  path: string,
  isArray: boolean,
  total: number,
  same: number,
  prevTotal: number
): void {
  if (immutableReported.has(path) || total < 2) return;
  // Push/filter/splice copies change the length by a little; a wholesale
  // resize is a different operation even if some items survive.
  if (isArray && Math.abs(prevTotal - total) > Math.max(1, total >> 2)) return;
  // At least half the leaves carried over unchanged, and at least one did.
  if (same === 0 || same * 2 < total) return;
  const changed = total - same;
  const shape = isArray ? "array" : "object";
  const repair = isArray
    ? `mutate the draft in place (push/splice/index assignment) so only the touched ` +
      `indices notify`
    : `assign the leaf on the draft (\`${path}.<key> = …\`) so only readers of that key re-run`;
  const message =
    `[IMMUTABLE_UPDATE_IN_STORE] "${path}" was replaced with a fresh ${shape} whose ` +
    `${isArray ? "items" : "leaves"} are mostly the same values (${same} of ${total} unchanged` +
    `${changed > 0 ? `, ${changed} changed` : ""}) — a spread-copy update. The store already ` +
    `tracks ${isArray ? "items" : "leaves"}; a new container makes every reader of "${path}" ` +
    `re-run for the ${changed === 1 ? "one that" : "few that"} moved. Instead, ${repair}. For ` +
    `data arriving from outside (a fetch result), merge it with reconcile(data, key)(${path}).`;
  const entry = emitDiagnostic({
    code: "IMMUTABLE_UPDATE_IN_STORE",
    kind: "perf",
    severity: "warn",
    message,
    nodeName: path,
    data: { path, shape, total, unchanged: same, changed }
  });
  // Paths are not unique across stores: a write under an excluded owner
  // (an adapter's own "store.list") must not spend the app's once-per-path slot.
  if (isSuppressed(entry)) return;
  immutableReported.add(path);
  reportDiagnostic(entry);
}

// --- Unstable list identity -----------------------------------------------------
//
// `<For>` keyed by identity (the default) treats every new object as a new
// row. When a re-fetch hands back fresh objects for the same records, or a
// spread-copy rebuilds the array, most rows are disposed and recreated —
// DOM, state, focus, and all — for data that did not change. mapArray knows
// exactly which items exited and entered; pairing them (by `id` when the
// items carry one, else by position) and sampling shallow equivalence turns
// that into a verdict: churn that replaced equivalent records is unstable
// identity, not a new list. A key function that still churns has the same
// disease one level up (its keys are not stable). Once per list.

const LIST_CHURN_SAMPLE = 8;
const listIdentityWarned = new WeakSet<object>();

function recordId(item: unknown): unknown {
  if (item === null || typeof item !== "object") return undefined;
  const o = item as Record<string, unknown>;
  return o.id ?? o.key ?? o._id ?? undefined;
}

function checkListIdentity(
  el: Computed<any>,
  removed: unknown[],
  created: unknown[],
  newLen: number,
  keyed: boolean
): void {
  if (listIdentityWarned.has(el)) return;
  // Most of the list turned over, and the turnover was a swap (rows out ≈ rows in).
  if (created.length < 2 || created.length * 2 < newLen) return;
  if (Math.abs(removed.length - created.length) > Math.max(1, created.length >> 2)) return;
  // Pair exited with entered: by record id when present, else by position.
  const byId = new Map<unknown, unknown>();
  for (const item of removed) {
    const id = recordId(item);
    if (id !== undefined) byId.set(id, item);
  }
  let sampled = 0;
  let equivalent = 0;
  const step = Math.max(1, Math.floor(created.length / LIST_CHURN_SAMPLE));
  for (let i = 0; i < created.length && sampled < LIST_CHURN_SAMPLE; i += step) {
    const item = created[i];
    const id = recordId(item);
    const prev = id !== undefined ? byId.get(id) : removed[i];
    if (prev === undefined || !isPlainShape(prev) || !isPlainShape(item)) continue;
    sampled++;
    if (shallowEquivalent(prev, item)) equivalent++;
  }
  if (sampled === 0 || equivalent * 2 < sampled) return;
  listIdentityWarned.add(el);
  const name = nodeName(el);
  const repair = keyed
    ? `The key function returned different keys for equivalent records — return a stable ` +
      `field (\`keyed: item => item.id\`), not the object or a computed value that changes ` +
      `with the fetch.`
    : `Key the list by a stable field (\`keyed: item => item.id\`), or merge the data into ` +
      `a store with reconcile(data, "id") so the same records keep the same identity.`;
  const message =
    `[UNSTABLE_LIST_IDENTITY] list "${name}" recreated ${created.length} of ${newLen} rows on ` +
    `an update where the entering items are equivalent to the ones they replaced ` +
    `(${equivalent} of ${sampled} sampled pairs identical field-for-field) — fresh objects ` +
    `for the same records, so identity keying threw away every row's DOM and state and ` +
    `rebuilt it. ${repair}`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "UNSTABLE_LIST_IDENTITY",
        kind: "perf",
        severity: "warn",
        message,
        nodeName: name,
        data: {
          removed: removed.length,
          created: created.length,
          length: newLen,
          sampled,
          equivalent,
          keyed
        }
      },
      el
    )
  );
}

// --- Async waterfall tracking -----------------------------------------------
//
// A "flight" is one registered async operation (`_inFlight` assignment) on one
// node. The engine can prove a sequential dependency when flight B's owning
// recompute was CAUSED by flight A's landing: the recompute frame's cause
// chain reaches A's "async" ChangeRecord, and that record carries A's own
// flight measurement. Chains are facts recorded unconditionally (queryable via
// `waterfalls()`); the ASYNC_WATERFALL diagnostic is the derived verdict.
//
// The sequentiality claim is made over flight ORIGINS, not sightings. The
// graph sees a flight when `_inFlight` is assigned, but the underlying work
// may be older: a route preloader kicked the fetch off at navigation and the
// dependent memo merely picked up the cached promise. Flagging that as a
// waterfall would blame a flattened chain. So each flight's origin is the
// EARLIEST provable start: a cooperative `markFlight(promise, startedAt)`
// stamp (preloaders/caches declaring their kickoff), else the first time the
// reactive system saw this same object (shared-promise dedupe), else this
// registration. A chain link exists only when `child.origin >= parent.landedAt`
// — work that provably existed before the upstream resolved is parallel, not
// sequential, and breaks the chain.
//
// What this deliberately does NOT claim: flights linked through untracked
// indirection (an effect that imperatively writes a signal a fetch depends
// on) are not chained — only graph-provable causality counts. And a cache
// handing out FRESH wrapper promises over old work defeats identity tracking
// unless it marks them (Solid Router's query() wraps exactly this way — its
// preloads must mark) — the residual blind spot is why the depth-2 verdict
// stays at `info` severity with no console output.

/** One landed flight: its node name, wall duration, and upstream chain. */
export interface FlightLink {
  name: string;
  ms: number;
}
export interface WaterfallRecord {
  /** Sequential flights, oldest first, ending at the flight that landed. */
  chain: FlightLink[];
  /** Summed wall time of the chain — the serialized cost. */
  sequentialMs: number;
}

interface LandedFlight extends FlightLink {
  chain: FlightLink[];
  /** Absolute timestamp of the landing — the bar a dependent's origin must clear. */
  landedAt: number;
}
interface LiveFlight {
  origin: number;
  /** changeSeq at flight start — associates the eventual landing stamp. */
  startSeq: number;
  chain: FlightLink[];
  /** The user interaction whose write started this flight, if any. */
  interaction?: ChangeOrigin;
}

/** Provenance of an async landing: the flight, under the interaction that started it. */
function asyncOrigin(el: Computed<any>): ChangeOrigin {
  const origin: ChangeOrigin = { kind: "async", name: nodeName(el) };
  const interaction = liveFlights.get(el)?.interaction;
  if (interaction !== undefined) origin.interaction = interaction;
  return origin;
}
// WeakMaps: an errored/abandoned flight must not leak its node or block GC.
const liveFlights = new WeakMap<Computed<any>, LiveFlight>();
const landedFlights = new WeakMap<ChangeRecord, LandedFlight>();
/**
 * Flight-object identity → earliest known start. Fed by markFlight() (the
 * cooperative preload/cache declaration — populated even while attribution
 * is disabled, so navigation-time marks survive a later enable()) and by
 * first sightings at registration.
 */
const flightOrigins = new WeakMap<object, number>();
let waterfallLog: WaterfallRecord[] = [];

/** Deepest landed-flight cause reachable through a cause list (derived links included). */
function flightCauseIn(causes: ChangeRecord[]): LandedFlight | null {
  let best: LandedFlight | null = null;
  for (const c of causes) {
    let found: LandedFlight | null = null;
    if (c.kind === "async") found = landedFlights.get(c) ?? null;
    else if (c.kind === "derived" && c.causes) found = flightCauseIn(c.causes);
    if (found !== null && (best === null || found.chain.length > best.chain.length)) best = found;
  }
  return best;
}

function trackFlightStart(el: Computed<any>, flight: object): void {
  const at = now();
  const origin = flightOrigins.get(flight) ?? at;
  if (origin === at) flightOrigins.set(flight, at);
  // Census: a flight still in the air when the node starts another was
  // superseded — its answer will be discarded.
  const stats = flightBucket(el);
  stats.flights++;
  if (liveFlights.has(el)) stats.abandoned++;
  // Nearest enclosing frame with causes: create runs carry null (a node born
  // inside a parent's recompute inherits the parent's causality — the
  // boundary-reveal case, and the lazy sibling whose first pull is gated
  // behind an earlier not-ready read), so walk down to the first re-run frame.
  let causes: ChangeRecord[] | null = null;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].causes !== null) {
      causes = frames[i].causes;
      break;
    }
  }
  const live: LiveFlight = { origin, startSeq: changeSeq, chain: [] };
  // Provenance: the flight belongs to whatever interaction caused the
  // recompute that started it (a create run under a click's handler — a
  // freshly mounted async node — inherits the ambient interaction instead).
  const interaction = causes !== null ? interactionIn(causes) : (currentInteraction ?? undefined);
  if (interaction !== undefined) live.interaction = interaction;
  if (options.waterfalls !== false && causes !== null) {
    let parent = flightCauseIn(causes);
    // The sequentiality test. A marked/previously-seen flight whose origin
    // predates the upstream landing was in the air alongside it: parallel.
    if (parent !== null && origin < parent.landedAt) parent = null;
    if (parent !== null) live.chain = [...parent.chain, { name: parent.name, ms: parent.ms }];
  }
  liveFlights.set(el, live);
}

/**
 * Flight landed (whether or not the value committed — the wall time was
 * spent either way). Attach the measurement to the landing's fresh "async"
 * stamp so downstream flights can chain through it, then judge the chain.
 */
function finalizeFlight(el: Computed<any>): void {
  const flight = liveFlights.get(el);
  if (flight === undefined) return;
  liveFlights.delete(el);
  const landedAt = now();
  const ms = landedAt - flight.origin;
  const stats = flightBucket(el);
  stats.landed++;
  stats.landedMs += ms;
  if (ms > stats.worstMs) stats.worstMs = ms;
  const record = (el as AttributedNode)._devChange;
  // Only a stamp this landing produced may carry the measurement — a stale
  // async record from a previous landing must not be re-labeled.
  if (record !== undefined && record.kind === "async" && record.seq > flight.startSeq)
    landedFlights.set(record, { name: nodeName(el), ms, chain: flight.chain, landedAt });
  checkWaterfall(el, flight.chain, ms);
}

function checkWaterfall(el: Computed<any>, chain: FlightLink[], ms: number): void {
  const cfg = options.waterfalls;
  if (cfg === false) return;
  if (chain.length > 0) {
    waterfallLog.push({
      chain: [...chain, { name: nodeName(el), ms }],
      sequentialMs: chain.reduce((sum, l) => sum + l.ms, ms)
    });
    if (waterfallLog.length > options.historyLimit) waterfallLog.shift();
  }
  // The verdict: trailing run of links that were each a real wait. A fast
  // tail (settled preload/cache hit) or a fast upstream breaks the sequence.
  if (ms < cfg.minFlightMs) return;
  let seq = 1;
  let totalMs = ms;
  for (let i = chain.length - 1; i >= 0 && chain[i].ms >= cfg.minFlightMs; i--) {
    seq++;
    totalMs += chain[i].ms;
  }
  if (seq < 2) return;
  const node = el as AttributedNode;
  if ((node._devWaterfallWarnedAt ?? 0) >= seq) return;
  node._devWaterfallWarnedAt = seq;
  const links = [...chain.slice(chain.length - (seq - 1)), { name: nodeName(el), ms }];
  const path = links.map(l => `"${l.name}" (${l.ms.toFixed(0)}ms)`).join(" → ");
  const message =
    `[ASYNC_WATERFALL] ${seq} sequential async flights — ${path} — ` +
    `${totalMs.toFixed(0)}ms serialized: each began only after the previous resolved ` +
    `(as far as this graph can see). If a later request doesn't need the earlier ` +
    `response, derive both from the same inputs so they start together; if the ` +
    `dependency is intrinsic, preload the dependent data or join the requests ` +
    `server-side. If this work WAS already started elsewhere (a preloader or request ` +
    `cache), have that layer stamp its promises with attribution.markFlight() ` +
    `from "@solidjs/signals/attribution".`;
  // Depth 2 is advisory-only (structured consumers see it; the console does
  // not): a 2-chain can be an intrinsic data dependency or an unmarked
  // preload. A 3+ chain that survived the origin test is near-certainly
  // structural — that one earns the console.
  const severity = seq > 2 ? "warn" : "info";
  const entry = emitDiagnostic(
    {
      code: "ASYNC_WATERFALL",
      kind: "perf",
      severity,
      message,
      nodeName: nodeName(el),
      data: { chain: links.map(l => ({ name: l.name, ms: l.ms })), sequentialMs: totalMs }
    },
    el
  );
  if (severity === "warn") reportDiagnostic(entry);
}

// --- Transition holds ---------------------------------------------------------
//
// A "hold" is the runtime's answer to a write that lands on async work: the
// write (and everything derived from it) stays staged in a transition until
// the async settles, so the screen never shows a torn state. That guarantee
// has a cost the graph cannot see on its own — from the user's side, the
// click did nothing until the data came back. Solid gives the screen four
// ways to acknowledge the wait: `isPending()` companions, `latest()` shadows,
// optimistic values (`createOptimistic`/`createOptimisticStore`, or an action
// writing them), and `affects()` marks. Each one is a graph fact this engine
// can census at settle. A hold that used none of them, and during which no
// effect ran at all, is a hold the user watched with no feedback: SILENT_HOLD.
//
// What is deliberately NOT judged: holds that staged no root write. An
// initial load, a bare `refresh()`, a re-ask — nothing the user did is
// waiting behind them, and `<Loading>` boundaries already own the "nothing
// yet" case. The census walks DOWNSTREAM from the held writes and blockers
// (subs + firewall children, the same reach as verdict repolling) because a
// probe on a derived memo (`isPending(() => filteredPosts())`) plants its
// companion on the memo, not on the source it derives from.

export interface HeldWrite {
  name: string;
  prev?: string;
  value?: string;
  origin?: ChangeOrigin;
}
export interface HoldEvent {
  /**
   * When the wait began (`performance.now()` clock): the interaction that
   * performed the held writes when one is known (`interaction.at`) or the
   * first flush that parked them, whichever is earlier. `at + holdMs` is the
   * commit.
   */
  at: number;
  /** Wall time the user waited: `at` to the commit. */
  holdMs: number;
  /**
   * The quiescent tail: from the LAST held write to join (the user's final
   * input) to the commit. Equal to `holdMs` for a single write; shorter when
   * the hold kept taking input. The LONG_HOLD measure.
   */
  tailMs: number;
  /** The user interaction whose writes were held, when the stamp is known. */
  interaction?: ChangeOrigin;
  /**
   * The declared unit of work the held writes belong to — the `navigation`
   * a router described via `withOrigin` — when one is known. What names the
   * hold by route (`navigation to /users/:id`) rather than by signal; the
   * same object as `navigations()[].origin`, so the two join by identity.
   */
  origin?: ChangeOrigin;
  /** Flushes that ended with the hold still open. */
  flushes: number;
  /** Root signal writes staged behind the hold (the user's unanswered input). */
  heldWrites: HeldWrite[];
  /** Async nodes the hold waited on (union across its parked flushes). */
  blockers: string[];
  /**
   * Feedback the graph provably rendered for this hold — an `isPending()`
   * reader, a `latest()` shadow, an optimistic value, an `affects()` mark —
   * one entry per affordance, in the order found. Empty and
   * `paintedDuringHold === 0` is the SILENT_HOLD signature.
   */
  acknowledgements: Acknowledgement[];
  /**
   * Effect callbacks that ran inside the hold's parked flushes. Mainline
   * effects are stashed while a hold is open, so these are lane effects —
   * readers of optimistic values and of `isPending()`/`latest()` companions,
   * i.e. the screen changing in response to the hold. An unrelated effect
   * cannot land here: it waits with everything else.
   */
  paintedDuringHold: number;
  /** The hold was opened (or joined) by an `action()`. */
  action: boolean;
}

/**
 * One way the screen acknowledged a hold. `reader` is where it was painted —
 * the owner path of the first effect the census found reading the
 * affordance (`["<App>", "<Feed>", "effect"]`), so a consumer can say WHICH
 * screen answered, not only that one did. Absent when the affordance was
 * registered but the census found no reader through the graph (an optimistic
 * store: its readers are proxy traps, not nodes). `feedback()` ranks
 * acknowledgements by `kind:source` (`isPending:posts`).
 */
export interface Acknowledgement {
  kind: "isPending" | "latest" | "optimistic" | "affects";
  /** The node the affordance hangs on — the async source for `isPending`/`latest`, the optimistic/affected node otherwise. */
  source: string;
  reader?: string[];
}

interface HoldState {
  start: number;
  flushes: number;
  blockers: Set<Computed<any>>;
  /** Keyed by `kind:source`, in the order found. */
  acknowledgements: Map<string, Acknowledgement>;
  painted: number;
  action: boolean;
}
const holdStates = new WeakMap<Transition, HoldState>();
let activeHold: HoldState | null = null;
let holdLog: HoldEvent[] = [];

/** Companions are optimistic nodes too; `_parentSource` marks them. */
function isCompanion(node: Signal<any> | Computed<any>): boolean {
  return !!node._x && node._x._parentSource !== undefined;
}

const HOLD_CENSUS_CAP = 10_000;

function acknowledge(
  state: HoldState,
  kind: Acknowledgement["kind"],
  source: string,
  reader: Computed<any> | null
): void {
  const key = `${kind}:${source}`;
  const existing = state.acknowledgements.get(key);
  const path = reader !== null ? ownerPath(reader) : undefined;
  // A later census (a merged transition, the settle pass) may find the
  // reader an earlier one missed.
  if (existing === undefined)
    state.acknowledgements.set(
      key,
      path !== undefined ? { kind, source, reader: path } : { kind, source }
    );
  else if (path !== undefined) existing.reader ??= path;
}

function censusRegistrations(t: Transition, state: HoldState): void {
  const budget = { left: HOLD_CENSUS_CAP };
  for (const node of t._optimisticNodes)
    if (!isCompanion(node))
      acknowledge(state, "optimistic", nodeName(node), reachesEffect(node, budget));
  for (const store of t._optimisticStores)
    acknowledge(state, "optimistic", (store as { _name?: string })?._name ?? "store", null);
  for (const node of t._affectsNodes)
    acknowledge(state, "affects", nodeName(node), reachesEffect(node, budget));
}

/**
 * Does anything that paints read `companion` — an effect, through however many
 * memos? A subscriber alone is not acknowledgement: memos compute eagerly, so a
 * router's `createMemo(() => isPending(location))` subscribes to the companion
 * whether or not the app ever renders the memo. Only an effect is the screen.
 * Returns the first effect found (the reader), or null.
 */
function reachesEffect(
  companion: Signal<any> | Computed<any>,
  budget: { left: number }
): Computed<any> | null {
  const seen = new Set<Signal<any> | Computed<any>>([companion]);
  const stack: (Signal<any> | Computed<any>)[] = [companion];
  while (stack.length > 0 && budget.left-- > 0) {
    const node = stack.pop()!;
    for (let s = node._subs; s !== null; s = s._nextSub) {
      const sub = s._sub;
      if ((sub as { _type?: number })._type) return sub;
      if (!seen.has(sub)) {
        seen.add(sub);
        stack.push(sub);
      }
    }
  }
  return null;
}

/** Companions an effect reads, anywhere downstream of the hold's nodes. */
function censusCompanions(roots: Iterable<Signal<any> | Computed<any>>, state: HoldState): void {
  const visited = new Set<Signal<any> | Computed<any>>();
  const stack: (Signal<any> | Computed<any>)[] = [...roots];
  const budget = { left: HOLD_CENSUS_CAP };
  while (stack.length > 0 && visited.size < HOLD_CENSUS_CAP) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    const x = node._x;
    if (x) {
      let reader: Computed<any> | null;
      if (x._pendingSignal !== undefined && (reader = reachesEffect(x._pendingSignal, budget)))
        acknowledge(state, "isPending", nodeName(node), reader);
      if (
        x._latestValueComputed !== undefined &&
        (reader = reachesEffect(x._latestValueComputed, budget))
      )
        acknowledge(state, "latest", nodeName(node), reader);
      for (
        let child: Signal<any> | null = (x as { _child?: Signal<any> | null })._child ?? null;
        child !== null;
        child = (child as { _nextChild?: Signal<any> | null })._nextChild ?? null
      )
        stack.push(child);
    }
    for (let s = node._subs; s !== null; s = s._nextSub) stack.push(s._sub);
  }
}

function holdState(t: Transition): HoldState {
  let state = holdStates.get(t);
  if (state === undefined) {
    state = {
      start: now(),
      flushes: 0,
      blockers: new Set(),
      acknowledgements: new Map(),
      painted: 0,
      action: false
    };
    holdStates.set(t, state);
  }
  return state;
}

function trackHoldStart(t: Transition): void {
  // Navigations and interactions learn they are held regardless of hold
  // tracking: their settle must wait for the transition either way (see flushEnd).
  markNavigationsHeld(t);
  markInteractionsHeld(t);
  if (options.holds === false) return;
  const state = holdState(t);
  state.flushes++;
  if (t._actions.length > 0) state.action = true;
  for (const [source, reporters] of t._asyncReporters)
    if (reporters.size > 0) state.blockers.add(source);
  censusRegistrations(t, state);
  activeHold = state;
}

function trackHoldMerge(target: Transition, outgoing: Transition): void {
  mergeInteractionsHeld(target, outgoing);
  const from = holdStates.get(outgoing);
  if (from === undefined) return;
  holdStates.delete(outgoing);
  const into = holdState(target);
  if (from.start < into.start) into.start = from.start;
  into.flushes += from.flushes;
  into.painted += from.painted;
  into.action ||= from.action;
  for (const b of from.blockers) into.blockers.add(b);
  for (const [key, a] of from.acknowledgements)
    if (!into.acknowledgements.has(key)) into.acknowledgements.set(key, a);
}

function trackHoldSettled(t: Transition): void {
  const state = holdStates.get(t);
  if (state === undefined) {
    // No hold was recorded (the transition completed in its first flush, or
    // hold tracking is off): navigations and interactions staged in it still
    // settle here.
    settleNavigations(t, undefined);
    settleInteractionsHeld(t, undefined);
    return;
  }
  holdStates.delete(t);
  // Root writes only: a memo in _pendingNodes is a derived hold, and the
  // question is whether the USER's input went unanswered.
  const heldWrites: HeldWrite[] = [];
  let subject: Signal<any> | null = null;
  let interaction: ChangeOrigin | undefined;
  let origin: ChangeOrigin | undefined;
  let lastJoinAt = -Infinity;
  for (const node of t._pendingNodes) {
    if (typeof (node as Computed<any>)._fn === "function" || isCompanion(node)) continue;
    const change = (node as AttributedNode)._devChange;
    if (change === undefined || change.kind !== "write") continue;
    if (subject === null) subject = node;
    const held: HeldWrite = { name: nodeName(node), prev: change.prev, value: change.value };
    if (change.origin !== undefined) held.origin = change.origin;
    heldWrites.push(held);
    // Earliest interaction among the held writes: the user has been waiting
    // since the first thing they did that this transaction is holding.
    const under = interactionOf(change.origin);
    if (under !== undefined && (interaction === undefined || under.at! < interaction.at!))
      interaction = under;
    // The declared frame the writes belong to — earliest navigation, by the
    // same reasoning.
    if (
      change.origin?.kind === "navigation" &&
      (origin === undefined || change.origin.at! < origin.at!)
    )
      origin = change.origin;
    // Latest write: a signal written twice while held carries the later
    // stamp, so this is the user's final input, not their first.
    if (change.at !== undefined && change.at > lastJoinAt) lastJoinAt = change.at;
  }
  if (heldWrites.length === 0) {
    settleNavigations(t, undefined);
    settleInteractionsHeld(t, undefined);
    return;
  }
  censusRegistrations(t, state);
  censusCompanions([...t._pendingNodes, ...state.blockers], state);
  const end = now();
  // The hold began no later than its first parked flush; an interaction stamp
  // reaches further back (dispatch). A node rewritten mid-hold keeps only its
  // latest record, so the surviving interaction may be a later one — the
  // flush clock keeps the first wait from being forgotten.
  const at = Math.min(state.start, interaction !== undefined ? interaction.at! : Infinity);
  const holdMs = end - at;
  const event: HoldEvent = {
    at,
    holdMs,
    tailMs: lastJoinAt === -Infinity ? holdMs : Math.min(holdMs, end - lastJoinAt),
    flushes: state.flushes,
    heldWrites,
    blockers: [...state.blockers].map(nodeName),
    acknowledgements: [...state.acknowledgements.values()],
    paintedDuringHold: state.painted,
    action: state.action
  };
  if (interaction !== undefined) event.interaction = interaction;
  if (origin !== undefined) event.origin = origin;
  holdLog.push(event);
  if (holdLog.length > options.historyLimit) holdLog.shift();
  // Bottom-up delivery: the hold, then the navigations it held, then the
  // interactions those belong to — each record complete when its parent is.
  emitRecord("hold", event);
  settleNavigations(t, event);
  settleInteractionsHeld(t, event);
  recordFeedbackHold(event);
  if (isSilentHold(event)) checkSilentHold(event, subject!);
  else checkLongHold(event, subject!);
}

/** `isLongHold` — the tail outlasted `longHolds.infoMs`. */
function isLongHold(event: HoldEvent): boolean {
  const cfg = options.longHolds;
  return cfg !== false && cfg !== undefined && event.tailMs >= cfg.infoMs;
}

function describeHeldWrites(event: HoldEvent): string {
  return event.heldWrites
    .map(w => (w.prev !== undefined ? `"${w.name}" (${w.prev} → ${w.value})` : `"${w.name}"`))
    .join(", ");
}

function describeBlockers(event: HoldEvent, lead: string): string {
  return event.blockers.length > 0
    ? ` ${lead} ${event.blockers.map(b => `"${b}"`).join(", ")}`
    : "";
}

/**
 * The boundary repair, shared by LONG_HOLD and a long SILENT_HOLD: a wait
 * this long should show a fallback, not a stale screen. A `Loading` boundary
 * lifts the write out of the hold only when it has not revealed yet or its
 * `on` prop changed — a revealed boundary with no `on` IS the stale screen.
 */
function boundaryRepair(event: HoldEvent): string {
  const key = event.heldWrites[0]?.name ?? "key";
  return (
    `A wait this long is past what a stale screen should carry: show a fallback instead. Put ` +
    `the reader behind a Loading boundary keyed on what changed — <Loading on={${key}()} ` +
    `fallback={…}> — so the write commits at once and the fallback shows where the data lands; ` +
    `a boundary that has already revealed keeps the old content unless \`on\` changes. If the ` +
    `data itself is the problem, preload it or cache it so the wait never gets this long.`
  );
}

function holdData(event: HoldEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {
    holdMs: event.holdMs,
    tailMs: event.tailMs,
    flushes: event.flushes,
    heldWrites: event.heldWrites.map(w => w.name),
    blockers: event.blockers,
    action: event.action
  };
  if (event.interaction !== undefined)
    data.interaction = { type: event.interaction.name, target: event.interaction.target };
  if (event.origin?.kind === "navigation") data.navigation = navigationData(event.origin);
  return data;
}

/**
 * Who the verdict sentence starts from: the interaction, with the navigation
 * it performed in parentheses — `click on a.nav (navigation to /users/:id)`;
 * the navigation alone when nothing user-dispatched is known (a redirect);
 * empty when neither is.
 */
function holdActor(event: HoldEvent): string {
  const via = event.origin !== undefined ? formatOrigin(event.origin) : "";
  if (event.interaction !== undefined)
    return `${formatOrigin(event.interaction)}${via ? ` (${via})` : ""}`;
  return via;
}

function checkSilentHold(event: HoldEvent, subject: Signal<any>): void {
  const cfg = options.holds;
  if (cfg === false) return;
  if (event.holdMs < cfg.infoMs) return;
  const ms = event.holdMs.toFixed(0);
  const writes = describeHeldWrites(event);
  const waitedOn = describeBlockers(event, "waiting on");
  // With the interaction (or navigation) stamped the sentence starts from
  // what the user did; without it, from the writes.
  const actor = holdActor(event);
  const who = actor ? `${actor} ` : "";
  let message = event.action
    ? `[SILENT_HOLD] ${who}${who ? "started an action that" : "an action"} held ${writes} for ` +
      `${ms}ms${waitedOn} and the screen showed nothing for the whole round-trip: no optimistic ` +
      `value, no isPending() reader, no affects() mark, and no effect ran while it was held. ` +
      `Pair the action with a createOptimistic/createOptimisticStore write for the expected ` +
      `outcome (it reverts on failure), or co-write a createOptimistic(false) "saving" flag ` +
      `the UI reads.`
    : `[SILENT_HOLD] ${who}${who ? "wrote" : "writes to"} ${writes}${who ? "; the write was" : " were"} ` +
      `held ${ms}ms${waitedOn} and the screen showed nothing for the wait: no ` +
      `isPending()/latest() reader downstream, no optimistic value, no affects() mark, and no ` +
      `effect ran while it was held — the interaction was dead for ${ms}ms. Show the wait: ` +
      `read isPending(() => ${event.blockers[0] ?? "source"}()) to render a busy state, or ` +
      `latest(${event.heldWrites[0].name}) to reveal the new input immediately while the data ` +
      `catches up. The hold itself is correct — do not "fix" this by moving the write off the ` +
      `async path.`;
  const long = isLongHold(event);
  if (long) message += ` ${boundaryRepair(event)}`;
  const severity = event.holdMs >= cfg.warnMs ? "warn" : "info";
  const data = holdData(event);
  data.long = long;
  const entry = emitDiagnostic(
    {
      code: "SILENT_HOLD",
      kind: "responsiveness",
      severity,
      message,
      nodeName: nodeName(subject),
      data
    },
    subject
  );
  if (severity === "warn") reportDiagnostic(entry);
}

function checkLongHold(event: HoldEvent, subject: Signal<any>): void {
  const cfg = options.longHolds;
  if (cfg === false || cfg === undefined) return;
  if (event.tailMs < cfg.infoMs) return;
  const tail = event.tailMs.toFixed(0);
  const writes = describeHeldWrites(event);
  const waitedOn = describeBlockers(event, "waiting on");
  const actor = holdActor(event);
  const who = actor ? `${actor} ` : "";
  const answered =
    event.acknowledgements.length > 0
      ? `${event.acknowledgements.map(a => `"${a.kind}:${a.source}"`).join(", ")} said it was pending`
      : `an effect painted meanwhile`;
  const sinceLast =
    event.tailMs < event.holdMs - 1
      ? ` after the last input (${event.holdMs.toFixed(0)}ms in all)`
      : "";
  const message =
    `[LONG_HOLD] ${who}${who ? "wrote" : "writes to"} ${writes}; the screen kept the old ` +
    `content for ${tail}ms${sinceLast}${waitedOn} — ${answered}, but the hold ran on well past ` +
    `the point where "loading" over stale content reads as broken. ${boundaryRepair(event)}`;
  const severity = event.tailMs >= cfg.warnMs ? "warn" : "info";
  const data = holdData(event);
  data.acknowledgements = event.acknowledgements;
  const entry = emitDiagnostic(
    {
      code: "LONG_HOLD",
      kind: "responsiveness",
      severity,
      message,
      nodeName: nodeName(subject),
      data
    },
    subject
  );
  if (severity === "warn") reportDiagnostic(entry);
}

// --- Navigations ------------------------------------------------------------------
//
// A navigation in Solid 2 is not a primitive: it is a plain write to the
// location (reads pull the route's async, and the runtime holds the write
// until the data is ready), so the engine already sees everything a
// navigation costs — the hold, the re-runs, the blockers, the silence — with
// one thing missing: that those writes WERE a navigation, and to which route.
// `withOrigin({ kind: "navigation", … })` is where a router says so, around
// its write; this section keeps one record per such frame and settles it
// when the work it caused is done. Nothing here knows any router; the seam
// is the frame, and the record is keyed by the frame object the writes
// stamped, so a hold or a cause chain resolves back to it by identity.
//
// A record settles once, one of three ways: `committed` — its writes went
// through in a drain no transition held (flushEnd is the instant the screen
// had them); `held` — they waited in a transition, whose commit is the
// instant (with the HoldEvent attached when hold tracking recorded one);
// `superseded` — a later write to the same node replaced its record before
// it landed (the user navigated again; the first never showed).
//
// Two things about the frame are deliberately late-bound. The router's ref is
// kept and re-read when the record settles (and when a hold on it is judged),
// so a match that was coarse at write time — a lazy subtree resolving inside
// the hold — can be refined onto the same object with no second API. And a
// redirect hop (`ref.redirect >= 1`) re-enters the pending navigation's frame
// object rather than opening one: its write replaces the pending one with the
// same origin, so nothing is superseded, the record keeps the user's request
// time and interaction, and its destination moves to the hop's while the
// abandoned one is kept in `redirects`.
//
// The seam assumes the graph holds the whole navigation: the write that lands
// the destination is the one the frame wraps, and everything it waits for is
// async the destination reads. A router that awaits part of its pipeline
// outside the graph (loaders resolved in its core before it publishes) wraps
// the publish instead, passing `at` from the user's request — the record then
// covers the write that actually showed, and the router-side wait is the
// router's to report.

/** A destination a navigation abandoned when a redirect sent it elsewhere. */
export interface NavigationHop {
  name?: string;
  to?: string;
  params?: Readonly<Record<string, string | undefined>>;
  /** When the redirect away from it was declared (`performance.now()` clock). */
  at: number;
}

export interface NavigationEvent {
  /** The matched route pattern the router gave — `/users/:id`. After a redirect, the final one. */
  name?: string;
  to?: string;
  from?: string;
  params?: Readonly<Record<string, string | undefined>>;
  /** When the navigation was requested (`performance.now()` clock). */
  at: number;
  /** The user interaction it ran under, when known — a link click. */
  interaction?: ChangeOrigin;
  /** Root writes the frame performed, redirect hops included. */
  writes: number;
  /** Destinations abandoned along the way, in order — present only when a redirect occurred. */
  redirects?: NavigationHop[];
  /**
   * Wall time from the request to settle: the end of the drain that committed
   * its writes, or the commit of the hold they waited in. `undefined` while
   * unsettled.
   */
  settledMs?: number;
  outcome?: "committed" | "held" | "superseded";
  /** The hold its writes waited in, when hold tracking recorded one. */
  hold?: HoldEvent;
  /**
   * The frame object its writes were stamped with — `ChangeRecord.origin` on
   * each, `HoldEvent.origin` on the hold. Join key, by identity.
   */
  origin: ChangeOrigin;
}

interface NavState {
  event: NavigationEvent;
  /** The router's description — re-read at settle (see `syncNavigation`). A redirect replaces it. */
  ref: OriginRef;
  /** Frames on the stack for this navigation: the opener's, plus a nested redirect hop's. */
  open: number;
  /** A flush parked its writes in a transition (`holdStart`). */
  held: boolean;
  /** `drainSeq` at its last write — a later drain committed it. */
  writeDrain: number;
}
const navStates = new WeakMap<ChangeOrigin, NavState>();
/** Opened, not yet settled. */
const openNavs = new Set<NavState>();
let navigationLog: NavigationEvent[] = [];
/** Drains completed since enable() — the clock `writeDrain` reads. */
let drainSeq = 0;

/**
 * Copy what the router currently says onto the frame (what writes stamped —
 * `formatOrigin` reads it) and the event. Called when the frame opens, when a
 * redirect re-describes it, and when the record settles, so a description
 * refined during the hold is what every consumer ends up reading.
 */
function syncNavigation(state: NavState): void {
  const { event, ref } = state;
  const frame = event.origin;
  if (ref.name === undefined) {
    delete frame.name;
    delete event.name;
  } else frame.name = event.name = ref.name;
  if (ref.to === undefined) {
    delete frame.to;
    delete event.to;
  } else frame.to = event.to = ref.to;
  if (ref.params === undefined) {
    delete frame.params;
    delete event.params;
  } else frame.params = event.params = ref.params;
}

function openNavigation(frame: ChangeOrigin, ref: OriginRef): void {
  const event: NavigationEvent = { at: frame.at!, writes: 0, origin: frame };
  if (frame.from !== undefined) event.from = frame.from;
  if (frame.interaction !== undefined) event.interaction = frame.interaction;
  const state: NavState = {
    event,
    ref,
    open: 1,
    held: false,
    writeDrain: drainSeq
  };
  syncNavigation(state);
  navStates.set(frame, state);
  openNavs.add(state);
  navigationLog.push(event);
  if (navigationLog.length > options.historyLimit) navigationLog.shift();
  noteInteractionNavigation(event);
}

/** The navigation a redirect hop folds onto: the most recently opened one still pending. */
function lastOpenNavigation(): NavState | undefined {
  let last: NavState | undefined;
  for (const state of openNavs) last = state;
  return last;
}

/** A redirect re-describes `state`: the current destination becomes a hop it abandoned. */
function redirectNavigation(state: NavState, ref: OriginRef): void {
  const event = state.event;
  // As the router last described the destination being left behind.
  syncNavigation(state);
  const hop: NavigationHop = { at: ref.at ?? now() };
  if (event.name !== undefined) hop.name = event.name;
  if (event.to !== undefined) hop.to = event.to;
  if (event.params !== undefined) hop.params = event.params;
  (event.redirects ??= []).push(hop);
  state.ref = ref;
  state.open++;
  syncNavigation(state);
}

function closeNavigation(frame: ChangeOrigin): void {
  const state = navStates.get(frame);
  if (state === undefined || --state.open > 0) return;
  syncNavigation(state);
  // Nothing to wait for: no write survived the equality gate (navigating to
  // where we already are), or a drain inside the frame already committed
  // them (`flush(() => setLocation(…))`) with no hold.
  if (state.event.writes === 0 || (!state.held && drainSeq > state.writeDrain))
    settleNavigation(state, "committed");
}

/** stampWrite: the record replacing `prior` on a node was just stamped. */
function noteNavigationWrite(prior: ChangeRecord | undefined, record: ChangeRecord): void {
  const origin = record.origin!;
  if (origin.kind === "navigation") {
    const state = navStates.get(origin);
    if (state !== undefined) {
      state.event.writes++;
      state.writeDrain = drainSeq;
    }
  }
  // The node now carries a different frame's record: whatever `prior`'s
  // navigation was waiting to show on it will never land as that navigation.
  const before = prior?.origin;
  if (before !== undefined && before !== origin && before.kind === "navigation") {
    const state = navStates.get(before);
    if (state !== undefined && openNavs.has(state)) settleNavigation(state, "superseded");
  }
}

/** holdStart: `t`'s staged writes are parked — their navigations settle with `t`. */
function markNavigationsHeld(t: Transition): void {
  if (openNavs.size === 0) return;
  for (const node of t._pendingNodes) {
    const origin = (node as AttributedNode)._devChange?.origin;
    if (origin?.kind !== "navigation") continue;
    const state = navStates.get(origin);
    if (state !== undefined) state.held = true;
  }
}

/** transitionSettled: `t` commits — the navigations whose writes it staged are done. */
function settleNavigations(t: Transition, hold: HoldEvent | undefined): void {
  if (openNavs.size === 0) return;
  for (const node of t._pendingNodes) {
    const origin = (node as AttributedNode)._devChange?.origin;
    if (origin?.kind !== "navigation") continue;
    const state = navStates.get(origin);
    if (state === undefined || !openNavs.has(state)) continue;
    // A navigation whose frame is still open when its transition commits
    // (`until()` inside the frame) settles here too: its writes are through.
    settleNavigation(state, state.held ? "held" : "committed", hold);
  }
}

/** flushEnd: every open, closed, unheld navigation's (and interaction's) writes just committed. */
function trackFlushEnd(): void {
  drainSeq++;
  for (const state of openNavs)
    if (state.open === 0 && !state.held) settleNavigation(state, "committed");
  for (const state of openInteractions) maybeSettleInteraction(state);
}

function settleNavigation(
  state: NavState,
  outcome: NonNullable<NavigationEvent["outcome"]>,
  hold?: HoldEvent
): void {
  if (!openNavs.has(state)) return;
  openNavs.delete(state);
  syncNavigation(state);
  const event = state.event;
  event.settledMs = now() - event.at;
  event.outcome = outcome;
  if (hold !== undefined) event.hold = hold;
  recordFeedbackNavigation(event);
  emitRecord("navigation", event);
  // The interaction that performed it may have been waiting only on this.
  const under = openInteractionOf(event.interaction);
  if (under !== undefined) maybeSettleInteraction(under);
}

// --- Interactions -----------------------------------------------------------------
//
// The interaction is the unit a person experiences: one click, and everything
// it cost until the screen had the answer. The engine already keys every
// downstream fact to the interaction frame — writes stamp it, re-runs trace to
// it through their causes, holds and navigations carry it — but each of those
// is a piece; `feedback().interactions` folds them by interaction NAME (every
// click on the same button is one row), and nothing gave one record per
// dispatch with a start, an end and the pieces attached. This section keeps
// that record and settles it once its work is done, so a consumer building a
// span per interaction (an APM adapter) neither infers the end from an idle
// gap nor sums quantized per-run times to approximate the wall clock.
//
// A record settles once, by the same drain clock navigations use: `idle` —
// the handler performed no root write (nothing to wait for; settles when the
// frame closes); `committed` — its writes went through in drains no
// transition held (the last such drain's `flushEnd` is the instant); `held`
// — at least one of its writes waited in a transition (the last hold's commit
// is the instant, each HoldEvent attached). A navigation the frame performed
// is attached too and must settle before the interaction does. Runs are
// counted while the record is open:
// re-runs whose cause chain reaches the frame, plus computations CREATED in
// those runs or in the frame's flushes (a create run has no causes, so it
// inherits the interaction of the run or effect callback building it).

export interface InteractionEvent {
  /** Event type — `click`, `keydown`, `input`… */
  name: string;
  /** The element hit, as the runtime described it — `button#next "Next →"`. */
  target?: string;
  /** Dispatch time (`performance.now()` clock). */
  at: number;
  /** Wall time of the handler itself, dispatch to return. */
  handlerMs: number;
  /** Root writes attributed to the frame: the handler's, and those of frames it opened (a navigation). */
  writes: number;
  /** Re-runs traced back to this interaction while the record was open. */
  runs: number;
  /** Computations created in those runs or in the frame's flushes (the "create 1,000 rows" work). */
  created: number;
  /** Summed self-time of `runs` and `created` (ms). Quantized per run; `settledMs` is the wall clock. */
  runMs: number;
  /** Holds its writes waited in, in settle order. */
  holds: HoldEvent[];
  /** Navigations performed under it, in open order. */
  navigations: NavigationEvent[];
  /**
   * Dispatch to settle: the handler's return when it wrote nothing, the end of
   * the drain that committed its writes, or the commit of the last hold they
   * waited in — whichever came last. `undefined` while unsettled.
   */
  settledMs?: number;
  outcome?: "idle" | "committed" | "held";
  /**
   * The frame object every downstream fact carries — `ChangeOrigin.interaction`
   * on writes and frames, `RerunEvent.interaction`, `HoldEvent.interaction`,
   * `NavigationEvent.interaction`. Join key, by identity.
   */
  origin: ChangeOrigin;
}

interface InteractionState {
  event: InteractionEvent;
  /** The frame is still on the stack (handler running). */
  open: boolean;
  /** `drainSeq` at its last write — a later drain committed it. */
  writeDrain: number;
  /** Transitions currently holding at least one of its writes. */
  heldIn: Set<Transition>;
  /** A flush parked its writes at some point (hold tracking on or off). */
  held: boolean;
}
const interactionStates = new WeakMap<ChangeOrigin, InteractionState>();
/** Opened, not yet settled. */
const openInteractions = new Set<InteractionState>();
let interactionLog: InteractionEvent[] = [];

function openInteraction(frame: ChangeOrigin): void {
  const event: InteractionEvent = {
    name: frame.name!,
    at: frame.at!,
    handlerMs: 0,
    writes: 0,
    runs: 0,
    created: 0,
    runMs: 0,
    holds: [],
    navigations: [],
    origin: frame
  };
  if (frame.target !== undefined) event.target = frame.target;
  const state: InteractionState = {
    event,
    open: true,
    writeDrain: drainSeq,
    heldIn: new Set(),
    held: false
  };
  interactionStates.set(frame, state);
  openInteractions.add(state);
  interactionLog.push(event);
  if (interactionLog.length > options.historyLimit) interactionLog.shift();
}

/** interactionEnd: the handler returned. */
function closeInteraction(frame: ChangeOrigin): void {
  const state = interactionStates.get(frame);
  if (state === undefined) return;
  state.open = false;
  const end = now();
  state.event.handlerMs = end - state.event.at;
  maybeSettleInteraction(state, end);
}

/** The open record a frame runs under, if any. */
function openInteractionOf(origin: ChangeOrigin | undefined): InteractionState | undefined {
  const interaction = interactionOf(origin);
  if (interaction === undefined) return undefined;
  const state = interactionStates.get(interaction);
  return state !== undefined && openInteractions.has(state) ? state : undefined;
}

/** stampWrite: a root write stamped `origin`. */
function noteInteractionWrite(origin: ChangeOrigin): void {
  const state = openInteractionOf(origin);
  if (state === undefined) return;
  state.event.writes++;
  state.writeDrain = drainSeq;
}

/** recordRerun / a create run: work attributed to the interaction. */
function noteInteractionRun(
  interaction: ChangeOrigin | undefined,
  selfMs: number,
  created: boolean
): void {
  const state = openInteractionOf(interaction);
  if (state === undefined) return;
  state.event[created ? "created" : "runs"]++;
  state.event.runMs += selfMs;
}

/** openNavigation: a navigation frame opened under the interaction. */
function noteInteractionNavigation(event: NavigationEvent): void {
  const state = openInteractionOf(event.interaction);
  if (state !== undefined) state.event.navigations.push(event);
}

/** holdStart: `t` parked writes — the interactions that performed them wait for `t`. */
function markInteractionsHeld(t: Transition): void {
  if (openInteractions.size === 0) return;
  for (const node of t._pendingNodes) {
    const state = openInteractionOf((node as AttributedNode)._devChange?.origin);
    if (state !== undefined) {
      state.heldIn.add(t);
      state.held = true;
    }
  }
}

/** transitionMerged: whoever waited for `outgoing` now waits for `target`. */
function mergeInteractionsHeld(target: Transition, outgoing: Transition): void {
  for (const state of openInteractions) if (state.heldIn.delete(outgoing)) state.heldIn.add(target);
}

/** transitionSettled: `t` committed — its holders' writes are through. */
function settleInteractionsHeld(t: Transition, hold: HoldEvent | undefined): void {
  if (openInteractions.size === 0) return;
  for (const state of openInteractions) {
    if (!state.heldIn.delete(t)) continue;
    if (hold !== undefined) state.event.holds.push(hold);
    maybeSettleInteraction(state);
  }
}

function maybeSettleInteraction(state: InteractionState, end: number = now()): void {
  const event = state.event;
  if (state.open || state.heldIn.size > 0) return;
  // A drain must have committed the last write (the handler's, or a redirect
  // hop's after the click's own drain) — the handler returning is not the
  // screen having it.
  if (event.writes > 0 && drainSeq <= state.writeDrain) return;
  for (const nav of event.navigations) if (nav.outcome === undefined) return;
  openInteractions.delete(state);
  event.settledMs = end - event.at;
  event.outcome = event.writes === 0 ? "idle" : state.held ? "held" : "committed";
  emitRecord("interaction", event);
}

/** The serializable face of a navigation origin for diagnostic `data`. */
function navigationData(origin: ChangeOrigin): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (origin.name !== undefined) data.name = origin.name;
  if (origin.to !== undefined) data.to = origin.to;
  if (origin.from !== undefined) data.from = origin.from;
  if (origin.params !== undefined) data.params = origin.params;
  return data;
}

// --- Feedback tables ----------------------------------------------------------
//
// costs() ranks scopes and writes by the time they burn; feedback() ranks what
// the USER waited on, folded from records the engine already keeps — the
// HoldEvents and the interaction on each RerunEvent — with no measurement of
// its own. Two views of one question, "what did the click cost the person who
// clicked": per async source, how often writes were held behind it, for how
// long, and whether the screen said anything meanwhile; per interaction, the
// synchronous re-run work it caused (the long-flush hazard) beside the time
// its writes spent held (the silent-hold hazard) — the two INP failure modes
// as columns of one row. Facts, not verdicts: every hold counts, not only the
// ones past SILENT_HOLD's thresholds, so a source acknowledged on one screen
// and silent on another shows up as exactly that.

export interface FeedbackSource {
  /** The async nodes the holds waited on; empty when an action alone kept them open. */
  sources: string[];
  holds: number;
  /** Summed wait across the holds (ms). */
  heldMs: number;
  worstMs: number;
  /** Holds with no acknowledgment at all — the SILENT_HOLD signature, at any duration. */
  silent: number;
  silentMs: number;
  /** Holds whose only acknowledgment was a `latest()` shadow: the input showed, nothing said "loading". */
  latestOnly: number;
  /**
   * Holds whose quiescent tail (last write to join → commit) reached
   * `longHolds.infoMs`, acknowledged or not — the LONG_HOLD signature at the
   * table level. The affordance is not the whole answer there: a fallback
   * (`Loading` keyed with `on`), a preload, a cache, or a faster source is.
   * `longMs` sums the tails.
   */
  long: number;
  longMs: number;
  /** Which affordances answered, and in how many holds — ranked. */
  acknowledgedBy: { by: string; holds: number }[];
  /** Interactions whose writes were held here, ranked by holds. */
  interactions: { interaction: string; holds: number }[];
  /** Distinct root writes that were held. */
  writes: string[];
  /** Holds an action opened or joined. */
  actions: number;
}

export interface FeedbackInteraction {
  /** `click on button#next "Next →"` — type and target; repeated dispatches fold together. */
  interaction: string;
  /** Distinct dispatches seen (by dispatch time). */
  dispatches: number;
  /** Re-runs traced back to this interaction, and their summed self-time. */
  runs: number;
  selfMs: number;
  /** The most re-run self-time a single dispatch caused — the long-flush hazard. */
  worstDispatchMs: number;
  /** Holds this interaction's writes waited in — the silent-hold hazard. */
  holds: number;
  heldMs: number;
  silentMs: number;
  worstHoldMs: number;
}

/** Per async source: how many flights it started, and how many it threw away. */
export interface FlightStats {
  source: string;
  /** Flights registered (a recompute that produced a new promise/iterable). */
  flights: number;
  /** Flights that landed (whether or not the value changed). */
  landed: number;
  /**
   * Flights superseded by a newer one before landing — the search-as-you-type
   * signature when large: every keystroke asked, most answers were discarded.
   * A debounced/equality-gated derivation between input and fetch is the repair.
   */
  abandoned: number;
  /** Summed and worst wall time of landed flights (ms). */
  landedMs: number;
  worstMs: number;
}

/** Per loading boundary: how long, and how briefly, it showed its fallback. */
export interface FallbackStats {
  /** The boundary's owner path (`<App> › <Feed>`), or `boundary` when unnamed. */
  boundary: string;
  /** Times the fallback was shown. */
  shows: number;
  /** Summed and worst fallback duration (ms) across completed shows. */
  shownMs: number;
  worstMs: number;
  /**
   * Shows shorter than the flash window (default 150ms): a spinner that
   * appeared and vanished — the other end of the SILENT_HOLD spectrum, too
   * much feedback for too little wait. A preload, a cache, or lifting the
   * fetch above the boundary removes the flash.
   */
  flashes: number;
}

/**
 * Per route: what navigating to it cost, folded from settled
 * `NavigationEvent`s — the route-level view a router integration used to
 * have to build itself, from the runtime's own facts.
 */
export interface FeedbackNavigation {
  /** The route pattern (`/users/:id`), or the concrete `to` when the router gave no pattern. */
  name: string;
  navigations: number;
  /** Summed and worst request-to-settle time (ms) across settled navigations. */
  settledMs: number;
  worstMs: number;
  /** Navigations whose writes waited in a hold, and the time they waited. */
  held: number;
  heldMs: number;
  /** Held navigations the screen acknowledged nothing for — the SILENT_HOLD signature. */
  silent: number;
  /** Navigations overwritten by a later one before they landed. */
  superseded: number;
  /** Navigations a redirect sent elsewhere on the way (keyed by where they ended up). */
  redirected: number;
}

interface SourceBucket {
  row: FeedbackSource;
  acks: Map<string, number>;
  interactions: Map<string, number>;
  writes: Set<string>;
}
interface InteractionBucket {
  row: FeedbackInteraction;
  /** Self-time per dispatch, keyed by dispatch time. */
  dispatches: Map<number, number>;
}
const feedbackSources = new Map<string, SourceBucket>();
const feedbackInteractions = new Map<string, InteractionBucket>();
const feedbackNavigations = new Map<string, FeedbackNavigation>();
const flightStats = new Map<Computed<any>, FlightStats>();
interface FallbackBucket {
  row: FallbackStats;
  /** Start of the show currently on screen, or null. */
  shownAt: number | null;
}
const fallbackStats = new Map<object, FallbackBucket>();
const FALLBACK_FLASH_MS = 150;

function flightBucket(el: Computed<any>): FlightStats {
  let row = flightStats.get(el);
  if (row === undefined) {
    row = { source: nodeName(el), flights: 0, landed: 0, abandoned: 0, landedMs: 0, worstMs: 0 };
    flightStats.set(el, row);
  }
  return row;
}

function trackFallback(boundary: object, tree: Computed<any> | undefined, shown: boolean): void {
  let bucket = fallbackStats.get(boundary);
  if (bucket === undefined) {
    bucket = {
      row: { boundary: "boundary", shows: 0, shownMs: 0, worstMs: 0, flashes: 0 },
      shownAt: null
    };
    fallbackStats.set(boundary, bucket);
  }
  // The first show can fire before the subtree exists; name on first sight.
  if (bucket.row.boundary === "boundary" && tree !== undefined) {
    const path = ownerPath(tree);
    if (path !== undefined) bucket.row.boundary = path.join(" › ");
  }
  if (shown) {
    if (bucket.shownAt === null) {
      bucket.shownAt = now();
      bucket.row.shows++;
    }
    return;
  }
  if (bucket.shownAt === null) return;
  const ms = now() - bucket.shownAt;
  bucket.shownAt = null;
  bucket.row.shownMs += ms;
  if (ms > bucket.row.worstMs) bucket.row.worstMs = ms;
  if (ms < FALLBACK_FLASH_MS) bucket.row.flashes++;
}

/** No affordance answered and nothing painted while held. */
function isSilentHold(event: HoldEvent): boolean {
  return event.paintedDuringHold === 0 && event.acknowledgements.length === 0;
}

function interactionBucket(interaction: ChangeOrigin): InteractionBucket {
  const key = formatOrigin(interaction);
  let bucket = feedbackInteractions.get(key);
  if (bucket === undefined) {
    bucket = {
      row: {
        interaction: key,
        dispatches: 0,
        runs: 0,
        selfMs: 0,
        worstDispatchMs: 0,
        holds: 0,
        heldMs: 0,
        silentMs: 0,
        worstHoldMs: 0
      },
      dispatches: new Map()
    };
    feedbackInteractions.set(key, bucket);
  }
  const at = interaction.at ?? 0;
  if (!bucket.dispatches.has(at)) {
    bucket.dispatches.set(at, 0);
    bucket.row.dispatches++;
  }
  return bucket;
}

function recordFeedbackRun(event: RerunEvent): void {
  if (event.interaction === undefined) return;
  const bucket = interactionBucket(event.interaction);
  bucket.row.runs++;
  bucket.row.selfMs += event.selfMs;
  const at = event.interaction.at ?? 0;
  const dispatchMs = bucket.dispatches.get(at)! + event.selfMs;
  bucket.dispatches.set(at, dispatchMs);
  if (dispatchMs > bucket.row.worstDispatchMs) bucket.row.worstDispatchMs = dispatchMs;
}

function recordFeedbackHold(event: HoldEvent): void {
  const sources = [...event.blockers].sort();
  const key = sources.join("\u0000");
  let bucket = feedbackSources.get(key);
  if (bucket === undefined) {
    bucket = {
      row: {
        sources,
        holds: 0,
        heldMs: 0,
        worstMs: 0,
        silent: 0,
        silentMs: 0,
        latestOnly: 0,
        long: 0,
        longMs: 0,
        acknowledgedBy: [],
        interactions: [],
        writes: [],
        actions: 0
      },
      acks: new Map(),
      interactions: new Map(),
      writes: new Set()
    };
    feedbackSources.set(key, bucket);
  }
  const row = bucket.row;
  const silent = isSilentHold(event);
  row.holds++;
  row.heldMs += event.holdMs;
  if (event.holdMs > row.worstMs) row.worstMs = event.holdMs;
  if (silent) {
    row.silent++;
    row.silentMs += event.holdMs;
  } else if (
    event.acknowledgements.length > 0 &&
    event.acknowledgements.every(a => a.kind === "latest")
  )
    row.latestOnly++;
  if (isLongHold(event)) {
    row.long++;
    row.longMs += event.tailMs;
  }
  if (event.action) row.actions++;
  for (const a of event.acknowledgements) {
    const by = `${a.kind}:${a.source}`;
    bucket.acks.set(by, (bucket.acks.get(by) ?? 0) + 1);
  }
  for (const w of event.heldWrites) bucket.writes.add(w.name);
  if (event.interaction !== undefined) {
    const key = formatOrigin(event.interaction);
    bucket.interactions.set(key, (bucket.interactions.get(key) ?? 0) + 1);
    const ib = interactionBucket(event.interaction);
    ib.row.holds++;
    ib.row.heldMs += event.holdMs;
    if (silent) ib.row.silentMs += event.holdMs;
    if (event.holdMs > ib.row.worstHoldMs) ib.row.worstHoldMs = event.holdMs;
  }
}

function recordFeedbackNavigation(event: NavigationEvent): void {
  const name = event.name ?? event.to;
  if (name === undefined) return;
  let row = feedbackNavigations.get(name);
  if (row === undefined) {
    row = {
      name,
      navigations: 0,
      settledMs: 0,
      worstMs: 0,
      held: 0,
      heldMs: 0,
      silent: 0,
      superseded: 0,
      redirected: 0
    };
    feedbackNavigations.set(name, row);
  }
  row.navigations++;
  if (event.redirects !== undefined) row.redirected++;
  if (event.outcome === "superseded") {
    row.superseded++;
    return;
  }
  const ms = event.settledMs!;
  row.settledMs += ms;
  if (ms > row.worstMs) row.worstMs = ms;
  if (event.outcome === "held") {
    row.held++;
    row.heldMs += event.hold?.holdMs ?? ms;
    if (event.hold !== undefined && isSilentHold(event.hold)) row.silent++;
  }
}

function rankedCounts<K extends string>(
  counts: Map<string, number>,
  key: K
): ({ [P in K]: string } & { holds: number })[] {
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name, holds]) => ({ [key]: name, holds }) as { [P in K]: string } & { holds: number });
}

export interface AttributionFeedbackTables {
  sources: FeedbackSource[];
  interactions: FeedbackInteraction[];
  /** Routes ranked by the time spent held navigating to them, then by total settle time. */
  navigations: FeedbackNavigation[];
  /** Async sources ranked by abandoned flights, then by flights. */
  flights: FlightStats[];
  /** Loading boundaries ranked by flashes, then by time shown. */
  fallbacks: FallbackStats[];
}

function feedbackTables(): AttributionFeedbackTables {
  const navigations = [...feedbackNavigations.values()]
    .map(row => ({ ...row }))
    .sort((a, b) => b.heldMs - a.heldMs || b.settledMs - a.settledMs);
  const flights = [...flightStats.values()]
    .map(row => ({ ...row }))
    .sort((a, b) => b.abandoned - a.abandoned || b.flights - a.flights);
  const fallbacks = [...fallbackStats.values()]
    .map(bucket => ({ ...bucket.row }))
    .sort((a, b) => b.flashes - a.flashes || b.shownMs - a.shownMs);
  const sources = [...feedbackSources.values()]
    .map(bucket => ({
      ...bucket.row,
      acknowledgedBy: rankedCounts(bucket.acks, "by"),
      interactions: rankedCounts(bucket.interactions, "interaction"),
      writes: [...bucket.writes]
    }))
    .sort((a, b) => b.silentMs - a.silentMs || b.heldMs - a.heldMs);
  // Ranked by the total time the user spent on it: held plus synchronous work.
  const interactions = [...feedbackInteractions.values()]
    .map(bucket => ({ ...bucket.row }))
    .sort((a, b) => b.heldMs + b.selfMs - (a.heldMs + a.selfMs));
  return { sources, interactions, navigations, flights, fallbacks };
}

// The engine's implementation of the core's dev hook points. Installed by
// enable(), uninstalled by disable() — while uninstalled the core pays one
// null check per site and nothing else.
let asyncStartSeq = 0;
let asyncStartTime = 0;
let asyncStartValue: unknown;
const engineHooks: AttributionHooks = {
  interactionStart,
  interactionEnd,
  originStart,
  originEnd,
  flushEnd() {
    trackFlushEnd();
  },
  recomputeStart(el, create) {
    const causes = create ? null : collectCauses(el);
    frames.push({
      start: now(),
      childMs: 0,
      causes,
      prevDeps: create ? null : captureDeps(el),
      // Mirror recompute's own prev-value resolution: an earlier run in the
      // same flush may still be holding in _pendingValue.
      prevValue: el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value,
      // A create run inherits the interaction of whatever is building it: the
      // enclosing recompute (a parent's fn creating children) or, at the top
      // of the recompute stack, the effect callback / handler frame.
      interaction:
        causes !== null
          ? interactionIn(causes)
          : frames.length > 0
            ? frames[frames.length - 1].interaction
            : enclosingInteraction()
    });
  },
  derivedChanged(el) {
    const frame = frames[frames.length - 1];
    stampDerived(el, frame !== undefined && frame.causes !== null ? frame.causes : []);
  },
  recomputeEnd(el, _create, changed, optimistic, transition, held) {
    const frame = frames.pop();
    // enable() can land mid-recompute: no opening frame, nothing to report.
    if (frame === undefined) return;
    const totalMs = now() - frame.start;
    if (frames.length > 0) frames[frames.length - 1].childMs += totalMs;
    const selfMs = Math.max(0, totalMs - frame.childMs);
    // Effect-output honesty: effects run with `_equals: false`, so core
    // reports EVERY effect recompute as changed — which made effect waste
    // invisible to costs() (and compiled JSX bindings are effects: the
    // fan-out waste a naive selected-row produces is all effects). The
    // engine re-derives the fact from its own snapshot: an identical
    // committed compute output is an unchanged run. `undefined` outputs are
    // exempt — a side-effect-only compute's work IS its effect phase, and
    // identity of `undefined` proves nothing.
    if (changed && frame.causes !== null && (el as { _type?: number })._type) {
      const committed = el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
      if (committed !== undefined && committed === frame.prevValue) changed = false;
    }
    // Unstable-output check: memos only, non-create, plain runs with a
    // committed change. The fresh value sits in `_pendingValue` for held
    // plain-flush memo commits and in `_value` for direct ones. Overlay runs
    // are excluded — an optimistic re-derive legitimately produces fresh
    // equivalents while the lane settles.
    if (
      frame.causes !== null &&
      changed &&
      !optimistic &&
      !transition &&
      !(el as { _type?: number })._type
    )
      checkUnstableOutput(
        el,
        frame.prevValue,
        el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value
      );
    if (frame.causes !== null)
      recordRerun(
        el,
        frame,
        { selfMs, totalMs },
        changed,
        optimistic ? "optimistic" : transition ? "held" : "plain",
        held
      );
    else if (!excludedNode(el)) {
      // Creation runs still get the wide-scope check: a memo can be born with
      // its coarse-read problem already in place — and their time is charged
      // to the interaction building them (the interaction record's `created`).
      checkDepWidth(el);
      noteInteractionRun(frame.interaction, selfMs, true);
    }
    markSeen(el);
  },
  write(el, prev, value) {
    stampWrite(el, "write", prev, value);
  },
  refreshed(el) {
    stampWrite(el, "refresh");
  },
  flightStart(el, flight) {
    trackFlightStart(el, flight);
  },
  asyncStart(el) {
    asyncStartSeq = (el as AttributedNode)._devChange?.seq ?? 0;
    asyncStartTime = el._time;
    asyncStartValue = el._value;
  },
  asyncEnd(el, prev, value, direct) {
    if (direct) {
      // Core calls this unconditionally (hook calls cannot live inside its
      // try blocks — see attribution-hooks.ts), so committed-ness is detected
      // here against the asyncStart snapshot: a direct commit moves `_value`
      // (or `_time`, for a same-reference commit under `equals: false`), and
      // a transition hold parks the value in `_pendingValue`. A landing the
      // equality gate swallowed moves none of them and must leave no stamp.
      const committed =
        el._value !== asyncStartValue ||
        el._time !== asyncStartTime ||
        (el as Computed<any>)._pendingValue === value;
      if (committed) stampWrite(el, "async", prev === undefined ? NO_VALUES : prev, value);
      // Flight over either way — an equality-swallowed landing still spent
      // the wall time (finalizeFlight only chains through a fresh stamp).
      finalizeFlight(el);
      return;
    }
    // Landed through setSignal: reclassify its "write" stamp as an async
    // landing — but only if it actually stamped (the value changed) since
    // asyncStart; a no-change landing must leave no fresh stamp behind.
    const change = (el as AttributedNode)._devChange;
    if (change !== undefined && change.seq > asyncStartSeq && change.kind === "write")
      stampWrite(el, "async", NO_VALUES, value);
    finalizeFlight(el);
  },
  effectRunStart(el) {
    pushFrame("effect", nodeName(el), (el as AttributedNode)._devRunInteraction, el);
  },
  effectRunEnd() {
    popFrame("effect");
    if (activeHold !== null) activeHold.painted++;
  },
  actionStepStart(it, name) {
    // Steps after a yield resume from a promise callback with no ambient
    // interaction; the one that started the action (its first step) is the
    // action's interaction for every step.
    let interaction = actionInteractions.get(it);
    if (interaction === undefined && !actionInteractions.has(it)) {
      interaction = currentInteraction ?? undefined;
      actionInteractions.set(it, interaction);
    }
    pushFrame("action", name, interaction);
  },
  actionStepEnd() {
    popFrame("action");
  },
  holdStart(t) {
    trackHoldStart(t);
  },
  holdEnd() {
    activeHold = null;
  },
  transitionSettled(t) {
    trackHoldSettled(t);
  },
  transitionMerged(target, outgoing) {
    trackHoldMerge(target, outgoing);
  },
  storeReplaced(path, isArray, total, unchanged, prevTotal) {
    checkImmutableUpdate(path, isArray, total, unchanged, prevTotal);
  },
  listChurn(el, removed, created, newLen, keyed) {
    checkListIdentity(el, removed, created, newLen, keyed);
  },
  boundaryFallback(boundary, tree, shown) {
    trackFallback(boundary, tree, shown);
  }
};

export const attribution: Attribution = {
  enable(opts?: AttributionOptions) {
    options = { ...defaultOptions, ...opts };
    attributionActive = true;
    frames.length = 0;
    scopeCosts.clear();
    writeCosts.clear();
    waterfallLog = [];
    holdLog = [];
    activeHold = null;
    feedbackSources.clear();
    feedbackInteractions.clear();
    feedbackNavigations.clear();
    navigationLog = [];
    openNavs.clear();
    interactionLog = [];
    openInteractions.clear();
    drainSeq = 0;
    reportedCycles.clear();
    relays.clear();
    immutableReported.clear();
    flightStats.clear();
    fallbackStats.clear();
    originFrames.length = 0;
    interactionStack.length = 0;
    currentInteraction = null;
    hotCauses.clear();
    setAttributionHooks(engineHooks);
  },
  disable() {
    attributionActive = false;
    clearListeners();
    history = [];
    frames.length = 0;
    scopeCosts.clear();
    writeCosts.clear();
    waterfallLog = [];
    holdLog = [];
    activeHold = null;
    feedbackSources.clear();
    feedbackInteractions.clear();
    feedbackNavigations.clear();
    navigationLog = [];
    openNavs.clear();
    interactionLog = [];
    openInteractions.clear();
    drainSeq = 0;
    reportedCycles.clear();
    relays.clear();
    immutableReported.clear();
    flightStats.clear();
    fallbackStats.clear();
    originFrames.length = 0;
    interactionStack.length = 0;
    currentInteraction = null;
    hotCauses.clear();
    setAttributionHooks(null);
  },
  subscribe(
    typeOrListener: AttributionRecordType | ((event: RerunEvent) => void),
    listener?: (record: never) => void
  ) {
    const type = typeof typeOrListener === "string" ? typeOrListener : "rerun";
    const fn = (typeof typeOrListener === "string" ? listener! : typeOrListener) as (
      record: never
    ) => void;
    const set = recordListeners[type] as Set<(record: never) => void>;
    set.add(fn);
    return () => set.delete(fn);
  },
  history() {
    return history;
  },
  why(target: unknown) {
    const node = ((target as Record<symbol, unknown>)?.[$REFRESH] ?? target) as Computed<unknown>;
    return history.filter(event => event.node === node);
  },
  subscriptions(target: unknown) {
    const node = ((target as Record<symbol, unknown>)?.[$REFRESH] ?? target) as Computed<any>;
    const names: string[] = [];
    for (let l = node?._deps ?? null; l !== null; l = l._nextDep) names.push(nodeName(l._dep));
    return names;
  },
  costs() {
    return {
      scopes: [...scopeCosts.values()].sort((a, b) => b.selfMs - a.selfMs),
      writes: [...writeCosts.values()].sort((a, b) => b.downstreamMs - a.downstreamMs)
    };
  },
  waterfalls() {
    return waterfallLog;
  },
  holds() {
    return holdLog;
  },
  navigations() {
    return navigationLog;
  },
  interactions() {
    return interactionLog;
  },
  feedback() {
    return feedbackTables();
  },
  markFlight(flight: object, startedAt: number = now()) {
    // Earliest wins: re-marking (a cache re-serving the same promise) must
    // not move the origin later.
    const existing = flightOrigins.get(flight);
    if (existing === undefined || startedAt < existing) flightOrigins.set(flight, startedAt);
  },
  format: formatRerun,
  formatOrigin
};
