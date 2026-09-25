import {
  setAttributionHooks,
  type AttributionHooks,
  type InteractionRef,
  type NavigationRef
} from "./attribution-hooks.js";
import { CONFIG_DERIVED_OVERRIDE, CONFIG_PLUMBING, NOT_PENDING } from "./constants.js";
import {
  anyExcluded,
  emitDiagnostic,
  GRAPH_SIZE_WARN_AT,
  liveRootOwners,
  isExcluded,
  isSuppressed,
  noteFanOut,
  OBSERVE,
  ownerPath,
  reportDiagnostic
} from "./dev.js";
import type { Transition } from "./scheduler.js";
import type { Computed, Owner, Signal } from "./types.js";

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
  /**
   * When the frame opened (`performance.now()` clock). Always set for
   * `interaction` and `navigation`; set on an `effect` frame only while an
   * `effect` record listener exists (the callback's timed start).
   */
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
  /**
   * Identity of the node that changed — the signal written, the memo whose
   * value changed — in the same id space as `RerunEvent.nodeId`, so a
   * derived cause joins the run that produced it and repeated writes to
   * one signal join each other where `name` alone would merge every
   * unnamed `signal`. Stamped on every record the engine makes; optional
   * for a record built elsewhere (a `HeldWrite`, a deserialized artifact).
   */
  nodeId?: number;
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
  /**
   * Identity of the scope that ran, stable for the node's lifetime within
   * the process: every run of one memo/effect carries the same `nodeId`, so
   * runs join to a scope after the record has left the process (where
   * `nodeName` alone would merge every unnamed `effect`). The engine's own
   * per-node id, also what `ChangeOrigin.run` and the cycle/relay checks
   * key on; not meaningful across processes or sessions. In-process
   * consumers get the live node as the `live` argument beside the record
   * (`OBSERVE.records.subscribe("rerun", (event, node) => …)`).
   */
  nodeId: number;
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

// --- Listener-gated records -----------------------------------------------------
//
// The records below describe work the engine already times or witnesses but
// has no verdict to reach about: a computation's first run, an effect
// callback, a scheduler drain, a flight, a fallback. They exist for a consumer
// that paints the timeline — a profiler track — where "what ran, when, for how
// long" IS the product. None enters a ring buffer or a fold, and none is built
// while nothing is subscribed to its type (`OBSERVE.records.subscribe("create",
// …)` turns it on): a mount storm creates thousands of nodes, and the
// console/agent reader must not pay for records only a timeline wants.

/**
 * A computation's creation run — the first run, the one with no causes to
 * explain (a `RerunEvent` is every run after it). The same measurements as a
 * re-run, less the causal fields a first run cannot have, and `interaction`
 * inherited from whatever built the node: the enclosing recompute (a
 * parent's fn creating children) or the handler/effect frame at the top of
 * the stack. Creation time is already charged to the interaction record's
 * `created`; this is the per-node face of that sum.
 */
export interface CreateEvent {
  /** When the run started (`performance.now()` clock). */
  at: number;
  nodeKind: "effect" | "memo";
  nodeName: string;
  /** Same id space as `RerunEvent.nodeId` — the node's later re-runs join here. */
  nodeId: number;
  /** Dependency count after this run. */
  depCount: number;
  /** Wall time of this run excluding nested recomputes (ms) — children created inside report their own. */
  selfMs: number;
  /** Wall time of this run including nested recomputes (ms). */
  totalMs: number;
  /** Posture the run executed under — see `RerunEvent.phase`. */
  phase: "plain" | "held" | "optimistic";
  /** The value was parked in `_pendingValue` rather than committed — see `RerunEvent.held`. */
  held: boolean;
  /** The interaction whose handler or flush built this node, if any. */
  interaction?: ChangeOrigin;
}

/**
 * One run of an effect's imperative half — the callback that touches the DOM
 * or the outside world — timed from entry to exit, cleanup included, whether
 * or not it threw. The compute half is the `RerunEvent`/`CreateEvent` with
 * the same `nodeId` that preceded it in the flush; `run` joins the two for a
 * re-run and is absent for a creation's first callback.
 */
export interface EffectRunEvent {
  /** When the callback started (`performance.now()` clock). */
  at: number;
  /** Wall time of the callback, nested runs included (ms). */
  durationMs: number;
  nodeId: number;
  nodeName: string;
  /** `RerunEvent.run` of the compute run whose effect phase this is; absent for a creation. */
  run?: number;
  /** The interaction the preceding compute run traced to, if any. */
  interaction?: ChangeOrigin;
}

/**
 * One `flush()` drain: from the scheduler picking up scheduled work until
 * every batch it processed has committed (effects ran) or been parked in a
 * held transition. The unit React's "Scheduler" track paints; the engine's
 * `flushEnd` settles interactions and navigations on the same instant.
 * Counts cover the runs the engine recorded inside the drain (excluded
 * scopes not counted).
 */
export interface FlushEvent {
  /** When the drain started (`performance.now()` clock). */
  at: number;
  /** Wall time of the drain (ms). */
  durationMs: number;
  /** Re-runs recorded during the drain. */
  runs: number;
  /** Creation runs during the drain. */
  created: number;
  /** A transition was judged incomplete during the drain — some of its writes stayed staged. */
  held: boolean;
  /**
   * The interaction every recorded run of the drain traced to, when there
   * was exactly one; absent when none did, or when runs for several
   * interactions shared the drain.
   */
  interaction?: ChangeOrigin;
}

/**
 * One async flight — a promise or async iterable an async computation
 * registered — from its origin (the earliest the engine knows: a
 * `markFlight` preload mark, or first sight at registration) to the moment
 * it landed or was superseded by the node's next flight (`abandoned` — the
 * answer will be discarded). A flight whose node is disposed mid-air
 * produces no record.
 */
export interface FlightEvent {
  nodeId: number;
  nodeName: string;
  /** Owner-chain labels of the async node, root first, when the node is owned. */
  ownerPath?: string[];
  /** When the flight started (`performance.now()` clock). */
  at: number;
  /** Wall time in the air (ms). */
  durationMs: number;
  outcome: "landed" | "abandoned";
  /** The interaction whose write started the flight, if any. */
  interaction?: ChangeOrigin;
}

/**
 * One showing of a loading boundary's fallback, delivered when it stops
 * showing. `ownerPath` names the boundary by its subtree's owner chain
 * (`["<App>", "<Feed>"]`); absent when the subtree never reported a path.
 * The fold in `feedback().fallbacks` is this record summed per boundary,
 * with the flash verdict.
 */
export interface FallbackEvent {
  ownerPath?: string[];
  /** When the fallback appeared (`performance.now()` clock). */
  at: number;
  /** How long it stayed (ms). */
  shownMs: number;
  /** The interaction whose work the boundary was waiting on, if the engine could tell. */
  interaction?: ChangeOrigin;
}

/**
 * The live graph's size at a navigation's settle — the moment an app has
 * finished moving between two screens, so a count that climbs visit after
 * visit is a root or a subscription the previous screen left behind.
 * Delivered on `OBSERVE.records.subscribe("graph", …)` per settled
 * navigation; a walk of the owner tree from the registered top-level roots,
 * made only when something listens or `graphGrowth` is on.
 */
export interface GraphEvent extends GraphSize {
  /** When the navigation settled (`performance.now()` clock). */
  at: number;
  /** The route pattern the navigation matched (`name`), else its `to`. */
  route?: string;
  /** The navigation this count belongs to. */
  navigation: NavigationEvent;
}

/**
 * The live reactive graph's size, as `graphSize()` counts it: the owner tree
 * from the registered top-level roots, then every computation and signal
 * reachable from it through dependencies and subscriptions — which is how
 * an ownerless effect (created with no owner, kept alive by its sources)
 * is found — and the edges between them.
 */
export interface GraphSize {
  /** Top-level roots alive (`render()`'s, module-scope `createRoot()`s, panels). */
  roots: number;
  /** Owners in the tree: roots, component owners, owned computations. */
  owners: number;
  /** Computations (memos, effects, boundaries), owned or reached through a subscription. */
  computations: number;
  /** Signals reached through a computation's dependencies. */
  signals: number;
  /** Dependency links — each computation's sources, counted once. */
  edges: number;
}

export interface AttributionOptions {
  /** Pretty-print each re-run to the console (default true). */
  log?: boolean;
  /**
   * Run the cost checks — the thresholded findings over the engine's own
   * accounting: `hotRuns`, `hotTime`, `wideDeps`, `unstableMemos`,
   * `fanOut`, `wastedRecompute` (default true). `false` turns all six off at once, whatever
   * their individual settings, so a consumer that wants records only (an
   * exporter, a profiler track) pays for none of their per-node bookkeeping.
   * Hold, long-hold and waterfall tracking are records with verdicts on top,
   * not checks, and are unaffected; disable those through their own options.
   */
  checks?: boolean;
  /** Capture the user stack frame of each write — slow (default false). */
  stacks?: boolean;
  /** Ring-buffer size for each `history(type)` buffer (default 200). */
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
   * Wasted-recompute warning: emit WASTED_RECOMPUTE when a scope re-ran at
   * least `minRuns` times within `windowMs` and `ratio` or more of those
   * runs produced an unchanged value while costing `budgetMs` or more of
   * compute in all (default 5 runs / 80% / 2ms / 1000ms). The equality gate
   * closed every time: the scope's inputs changed without changing its
   * result, so the runs were pure cost — the profiler-shaped fact
   * `costs().wastedMs` sums, as a finding. Held and overlay runs are not
   * counted (they may be replayed). Once per window per scope. `false`
   * disables.
   */
  wastedRecompute?: { minRuns: number; ratio: number; budgetMs: number; windowMs: number } | false;
  /**
   * HUGE_FAN_OUT threshold while the engine is enabled: emit the finding
   * when a committed root invalidation (write, refresh, async landing)
   * reaches a node with at least this many subscribers (default 250). The
   * same code the always-on core check emits from GRAPH_SIZE_WARN_AT (2000)
   * up, with `data.write` naming the invalidation; the engine hands over to
   * the core there, so one change never carries two findings. Once per
   * node, re-warning once the count has grown by another 500. `false`
   * leaves only the always-on threshold.
   */
  fanOut?: number | false;
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
  /**
   * Graph-growth warning: emit GRAPH_GROWTH when the live owner count at the
   * settle of the same route has climbed on `visits` consecutive visits
   * (default 3) to `ratio` or more of the first (default 1.25) — a root or a
   * subscription each visit leaves behind, the leak class a heap snapshot
   * finds. The count is a walk at settle, never per node. `false` disables.
   */
  graphGrowth?: { visits: number; ratio: number } | false;
  /**
   * Abandoned-flights warning: emit ABANDONED_FLIGHTS when one async source
   * abandons `count` flights within `windowMs` — each superseded by the
   * next before it landed (default 3 / 1000ms: the request-per-keystroke
   * signature, every input asking again and the answers discarded). Once
   * per window per source. `false` disables.
   */
  abandonedFlights?: { count: number; windowMs: number } | false;
  /**
   * Fallback-flash finding: emit FALLBACK_FLASH (`info`) when a `Loading`
   * boundary's fallback shows for less than `FALLBACK_FLASH_MS` (150ms) — a
   * spinner that appeared and vanished, too much feedback for too little
   * wait (default true). `false` disables.
   */
  fallbackFlashes?: boolean;
  /**
   * Stacked-holds warning: emit STACKED_HOLDS when `count` or more
   * interactions are waiting in one hold when it commits (default 3) — the
   * person kept clicking or typing while the first answer was in the air,
   * and every one of them waited on the same source. `false` disables.
   */
  stackedHolds?: { count: number } | false;
  /**
   * Optimistic-revert finding: emit OPTIMISTIC_REVERTED (`info`) when an
   * optimistic value the screen showed is replaced by a different one —
   * reverted at settle, or superseded by the truth (default true). The
   * runtime's own optimistic nodes — `isPending`/`latest` companions and
   * derived overrides — are never judged: they are the acknowledgement
   * machinery, not a guess the person saw. `false` disables.
   */
  optimisticReverts?: boolean;
}

/** A fallback shown for less than this is a flash: feedback for a wait too short to need it. */
export const FALLBACK_FLASH_MS = 150;

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
  /** Longest sequential-flight chain already warned for this node. */
  _devWaterfallWarnedAt?: number;
  /** WASTED_RECOMPUTE window: runs, no-op runs and their self-time since `_devWasteWinStart`. */
  _devWasteWinStart?: number;
  _devWasteRuns?: number;
  _devWasted?: number;
  _devWastedMs?: number;
  _devWasteWarned?: boolean;
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
 * Under an owner the observer marked as its own (`OBSERVE.exclude`), or
 * framework plumbing itself (`CONFIG_PLUMBING` — the HMR memo between a
 * component's root and its body, which is nobody's node): the engine records
 * nothing about the node. Plumbing is a bit read and excludes the node alone,
 * not what it owns; the observer exclusion is cached per node once any
 * exists, before that a flag read.
 */
function excludedNode(el: Computed<any> | Signal<any>): boolean {
  if ((el._config & CONFIG_PLUMBING) !== 0) return true;
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
  checks: true,
  stacks: false,
  historyLimit: 200,
  hotRuns: { count: 120, windowMs: 1000 } as { count: number; windowMs: number } | false,
  wideDeps: 30 as number | false,
  hotTime: { budgetMs: 8, windowMs: 1000 } as { budgetMs: number; windowMs: number } | false,
  unstableMemos: 4 as number | false,
  wastedRecompute: { minRuns: 5, ratio: 0.8, budgetMs: 2, windowMs: 1000 } as
    | { minRuns: number; ratio: number; budgetMs: number; windowMs: number }
    | false,
  fanOut: 250 as number | false,
  waterfalls: { minFlightMs: 50 } as { minFlightMs: number } | false,
  holds: { infoMs: 100, warnMs: 200 } as { infoMs: number; warnMs: number } | false,
  longHolds: { infoMs: 500, warnMs: 1000 } as { infoMs: number; warnMs: number } | false,
  graphGrowth: { visits: 3, ratio: 1.25 } as { visits: number; ratio: number } | false,
  abandonedFlights: { count: 3, windowMs: 1000 } as { count: number; windowMs: number } | false,
  fallbackFlashes: true,
  optimisticReverts: true,
  stackedHolds: { count: 3 } as { count: number } | false
};
let options: typeof defaultOptions = { ...defaultOptions };
let history: RerunEvent[] = [];

/**
 * The engine's records go out on the core's channel, `OBSERVE.records` —
 * the one every runtime emits on — under the types `RecordTypes` declares
 * for it (`rerun`, `create`, `effect`, `flush`, `flight`, `fallback`,
 * `interaction`, `hold`, `navigation`, `graph`), each with the live node as
 * `live` where the record has one. `records.observed(type)` is the
 * pre-check the listener-gated records cost nothing without; the channel
 * is process-wide and the subscriptions on it are the consumer's, so the
 * engine neither holds nor clears listeners of its own.
 */
const records = OBSERVE.records;

/**
 * The ring buffers `attribution.history(type)` reads, by type. Four of the
 * five are the channel's records kept since the window opened; `waterfall`
 * is a fact the engine keeps but never emits — a graph-provable sequential
 * flight chain (`WaterfallRecord`), of which the ASYNC_WATERFALL finding is
 * the thresholded view.
 */
export interface HistoryRecords {
  rerun: RerunEvent;
  waterfall: WaterfallRecord;
  hold: HoldEvent;
  navigation: NavigationEvent;
  interaction: InteractionEvent;
}
export type HistoryType = keyof HistoryRecords;

/** @internal The engine's clock: `performance.now()` where it exists. */
export const now: () => number =
  typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

// Per-recompute frames: recomputes nest (pulls, child creation inside a
// parent's fn), so each frame carries the causes/prev-deps snapshot from
// recomputeStart plus the time its children consumed — the parent subtracts
// child time for honest self-time, the same discipline every profiler uses.
interface RunFrame {
  start: number;
  childMs: number;
  causes: ChangeRecord[] | null; // null on create runs
  /**
   * The dep identities at run entry, for the record's subscription diff —
   * captured only when a re-run RECORD is wanted (see `wantsRerun`), so
   * `null` on a create run and on a re-run nothing will hear: the engine's
   * checks read the facts below, not the record.
   */
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

/**
 * @internal The fold tables' seam. The engine emits records; the tables that
 * fold them — `costs()` (scopes and writes), `feedback()` (sources,
 * interactions, navigations, flights, fallbacks) — live in their own modules
 * and register here when imported, so a consumer that only subscribes to
 * records never ships them. Each hook fires at the moment the engine has the
 * fact; `reset` on `enable()`/`disable()`. With nothing registered every
 * site is one empty loop.
 */
export interface FoldHooks {
  rerun?(el: Computed<any>, event: RerunEvent): void;
  hold?(event: HoldEvent): void;
  navigation?(event: NavigationEvent): void;
  /** A flight started; `abandoned` when it superseded one still in the air. */
  flightStart?(el: Computed<any>, abandoned: boolean): void;
  flightLanded?(el: Computed<any>, ms: number): void;
  fallback?(boundary: object, tree: Computed<any> | undefined, shown: boolean): void;
  reset?(): void;
}
const folds: FoldHooks[] = [];
/** @internal */
export function registerFold(hooks: FoldHooks): void {
  folds.push(hooks);
}

/** @internal Root cause names of a cause chain — the writes/landings/refreshes the chain bottoms out in. */
export function rootsOf(causes: ChangeRecord[], out: Set<string>): void {
  for (const c of causes) {
    if (c.kind === "derived" && c.causes && c.causes.length > 0) rootsOf(c.causes, out);
    else out.add(c.name);
  }
}

export function nodeName(node: Signal<any> | Computed<any>): string {
  return (node as AttributedNode & { _name?: string })._name ?? "anonymous";
}

/** The record vocabulary for a computation's kind: effects carry a `_type`, memos do not. */
function nodeKind(el: Computed<any>): "effect" | "memo" {
  return (el as { _type?: number })._type ? "effect" : "memo";
}

/**
 * Whether a re-run record has an audience — a listener on the channel, an
 * imported fold (`costs`/`feedback`), or the console log. Read at recompute
 * START (the subscription diff needs the deps as they were), so a listener
 * arriving mid-run hears the next one. Without an audience the engine still
 * runs every check and keeps every per-node fact; only the record — its
 * cause list copy, dep diff, previews — is not built, and `history("rerun")`
 * stays empty.
 */
function wantsRerun(): boolean {
  return options.log || folds.length > 0 || records.observed("rerun");
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
  // One clock read: the frame opens now; the interaction began at `ref.at`
  // when the runtime dated it (the event's own timestamp), else now too.
  const opened = now();
  const origin: ChangeOrigin = { kind: "interaction", name: ref.type, at: ref.at ?? opened };
  if (ref.target) origin.target = ref.target;
  currentInteraction = origin;
  openInteraction(origin, opened);
}

function interactionEnd(returned?: unknown): void {
  const closing = currentInteraction;
  currentInteraction = interactionStack.length ? interactionStack.pop()! : null;
  if (closing !== null) closeInteraction(closing, returned);
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

/** The root origin a cause list traces back to — the stamp of the nearest root write, derived links walked. */
function originIn(causes: ChangeRecord[]): ChangeOrigin | undefined {
  for (const c of causes) {
    const found =
      c.kind === "derived" ? (c.causes !== undefined ? originIn(c.causes) : undefined) : c.origin;
    if (found !== undefined && found.kind !== "external") return found;
  }
  return undefined;
}

/**
 * The `currentOrigin` hook: what a runtime recording its own fact right now
 * (a server-function call) should stamp it with. Inside a recompute the
 * fact belongs to the change that caused the run — a `createAsync` calling
 * the server on a navigation's write is the navigation's, and through it the
 * click's — walked down past create runs the way `trackFlightStart` does,
 * since a node born inside a parent's run inherits the parent's causality.
 * Outside one — or when the causes were themselves external (a memo a
 * handler pulls, stale from a timer's write) — it is the write's answer
 * (`currentOrigin`), minus the external sentinel: "none known" is
 * `undefined` on a record, as `HoldEvent.origin` has it. The objects
 * returned are the engine's own frames, so the caller's record joins
 * `InteractionEvent.origin` / `NavigationEvent.origin` by identity.
 */
function ambientOrigin(): ChangeOrigin | undefined {
  for (let i = frames.length - 1; i >= 0; i--) {
    const causes = frames[i].causes;
    if (causes !== null) {
      const cause = originIn(causes);
      if (cause !== undefined) return cause;
      break;
    }
  }
  const origin = currentOrigin();
  return origin === EXTERNAL_ORIGIN ? undefined : origin;
}

/**
 * What the engine knows about an effect frame beyond its serializable face:
 * the node, and the causes of the run whose effect phase this is (undefined
 * for a create run). `ChangeRecord.origin` IS the frame object, so a write's
 * origin resolves back to this through the map — the hop the effect-cycle
 * walk needs (see checkEffectCycle).
 *
 * Populated lazily, by the first WRITE that names a frame as its origin
 * (`noteEffectOrigin`), not by every callback: every reader resolves the
 * map through a write record's `origin`, so a frame no write ever stamped
 * is never looked up — and the overwhelming majority of effect callbacks
 * (compiled DOM bindings) write nothing. A WeakMap write per callback was
 * a measurable share of the enabled engine's per-effect cost; per writing
 * callback it is noise.
 */
interface EffectFrameInfo {
  node: Computed<any>;
  causes: ChangeRecord[] | undefined;
}
const effectFrames = new WeakMap<ChangeOrigin, EffectFrameInfo>();
/**
 * The nodes of the open effect frames, innermost last — parallel to the
 * `effect` entries of `originFrames`, so the frame on top resolves to its
 * node without a map. A stack, not a single slot: a render effect created
 * inside a callback runs its own callback synchronously.
 */
const effectStack: Computed<any>[] = [];

/**
 * A write just stamped `origin`. If it is the innermost effect frame (a
 * root write's origin is always the innermost open frame, see `stampWrite`)
 * and no earlier write registered it, register it now with the node on top
 * of the effect stack. An origin that is an effect frame but not the top is
 * inherited — reached through an earlier write's record — and that write
 * registered it.
 */
function noteEffectOrigin(origin: ChangeOrigin): void {
  if (origin.kind !== "effect" || effectFrames.has(origin)) return;
  if (originFrames[originFrames.length - 1] !== origin) return;
  const node = effectStack[effectStack.length - 1];
  if (node !== undefined)
    effectFrames.set(origin, { node, causes: (node as AttributedNode)._devRunCauses });
}

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
    // The frame → node map is filled by the first write inside the callback
    // (noteEffectOrigin), not here: most callbacks never write.
    effectStack.push(effect);
  }
  originFrames.push(frame);
}

function popFrame(kind: "effect" | "action" | "navigation") {
  // Frames are strictly nested; a mismatch means enable() landed mid-frame
  // (the opener never pushed) — leave the stack alone rather than pop a stranger.
  const top = originFrames[originFrames.length - 1];
  if (top !== undefined && top.kind === kind) {
    originFrames.pop();
    if (kind === "effect") effectStack.pop();
  }
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
function originStart(ref: NavigationRef): void {
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
 * HUGE_FAN_OUT from the engine's lower `fanOut` threshold (see dev.ts): a
 * committed root invalidation reaching hundreds of subscribers re-runs all
 * of them this flush. Counts the subscriber list itself (an engine-only
 * walk, on the write; the core keeps no per-node count — a live `_subCount`
 * was a post-construction field that forked node shapes). Stops at
 * GRAPH_SIZE_WARN_AT, where the always-on core check takes over, so the two
 * never fire for the same write; the once-per-node dedupe is the core's.
 */
function checkFanOut(
  node: Signal<any> | Computed<any>,
  kind: Exclude<ChangeKind, "derived">
): void {
  const limit = options.fanOut;
  if (typeof limit !== "number") return;
  const subs = countSubscribers(node);
  if (subs < limit || subs >= GRAPH_SIZE_WARN_AT) return;
  noteFanOut(node, subs, kind);
}

function stampWrite(
  node: Signal<any> | Computed<any>,
  kind: Exclude<ChangeKind, "derived">,
  prev: unknown = NO_VALUES,
  value: unknown = NO_VALUES
): void {
  const record: ChangeRecord = {
    seq: ++changeSeq,
    kind,
    name: nodeName(node),
    nodeId: devId(node)
  };
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
  noteInteractionWrite(record.origin, excludedNode(node));
  if (kind === "write") trackEffectWrite(node, record, value);
  // stampWrite is the single funnel for committed root invalidations (sync
  // writes, refresh(), async landings), which makes it the one place the
  // engine's fan-out check needs to live.
  checkFanOut(node, kind);
}

/** Record a derived change (memo produced a new value) with its causes. */
function stampDerived(node: Computed<any>, causes: ChangeRecord[]): void {
  (node as AttributedNode)._devChange = {
    seq: ++changeSeq,
    kind: "derived",
    name: nodeName(node),
    nodeId: devId(node),
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

/**
 * Snapshot the dep identities of the node's last pass (call before a run
 * replaces them, or after it to read the fresh set). The validated prefix
 * [`_deps`..`_depsTail`] is that pass's set; links past the tail are a
 * previous pass's, kept linked while the frame they fed is still the
 * committed one (A30 — a staged memo pass, or an effect pass whose run is
 * still owed) and not part of the subscription diff.
 */
function captureDeps(el: Computed<any>): unknown[] {
  const deps: unknown[] = [];
  for (let l = el._deps; l !== null; l = l._nextDep) {
    deps.push(l._dep);
    if (l === el._depsTail) break;
  }
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
    if (l === el._depsTail) break; // the validated prefix, as captureDeps
  }
  const node = el as AttributedNode;
  if (count < limit || count < (node._devWideWarnedAt ?? 0) * 1.5) return;
  node._devWideWarnedAt = count;
  const message =
    `[WIDE_SCOPE_DEPS] ${nodeKind(el)} "${nodeName(el)}" is subscribed to ${count} sources — ` +
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
function checkHotRuns(el: Computed<any>, causes: ChangeRecord[]): void {
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
  rootsOf(causes, roots);
  const causeKey = roots.size > 0 ? [...roots].sort().join(", ") : "(untracked)";
  let window = hotCauses.get(causeKey);
  if (window === undefined || now - window.winStart > cfg.windowMs) {
    window = { winStart: now, scopes: 0, runs: 0, nextMilestone: HOT_FANOUT_FIRST_MILESTONE };
    hotCauses.set(causeKey, window);
  }
  window.scopes++;
  window.runs += node._devWinCount;

  if (window.scopes === 1) {
    const rootCause = causes.map(c => `"${c.name}" (${c.kind})`).join(", ");
    const message =
      `[HOT_SCOPE_RERUNS] ${nodeKind(el)} "${nodeName(el)}" re-ran ${node._devWinCount} times ` +
      `in ${Math.max(1, now - node._devWinStart)}ms — a hot signal is likely leaking into this ` +
      `scope. Latest cause: ${rootCause || "(untracked pull)"}`;
    reportDiagnostic(
      emitDiagnostic(
        {
          code: "HOT_SCOPE_RERUNS",
          kind: "perf",
          severity: "warn",
          message,
          nodeName: nodeName(el),
          data: {
            runs: node._devWinCount,
            windowMs: cfg.windowMs,
            causes: causes.map(c => c.name)
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
function checkHotTime(el: Computed<any>, selfMs: number, causes: ChangeRecord[]): void {
  const cfg = options.hotTime;
  if (cfg === false) return;
  const node = el as AttributedNode;
  const at = now();
  if (node._devTimeWinStart === undefined || at - node._devTimeWinStart > cfg.windowMs) {
    node._devTimeWinStart = at;
    node._devTimeWinMs = 0;
    node._devTimeWarned = false;
  }
  node._devTimeWinMs = (node._devTimeWinMs ?? 0) + selfMs;
  if (node._devTimeWarned || node._devTimeWinMs < cfg.budgetMs) return;
  node._devTimeWarned = true;
  const rootCause = causes.map(c => `"${c.name}" (${c.kind})`).join(", ");
  const message =
    `[HOT_SCOPE_TIME] ${nodeKind(el)} "${nodeName(el)}" spent ` +
    `${node._devTimeWinMs.toFixed(1)}ms of compute inside one ${cfg.windowMs}ms window ` +
    `(budget ${cfg.budgetMs}ms). Latest cause: ${rootCause || "(untracked pull)"}`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "HOT_SCOPE_TIME",
        kind: "perf",
        severity: "warn",
        message,
        nodeName: nodeName(el),
        data: {
          spentMs: node._devTimeWinMs,
          budgetMs: cfg.budgetMs,
          windowMs: cfg.windowMs,
          causes: causes.map(c => c.name)
        }
      },
      el
    )
  );
}

/**
 * A scope whose equality gate closes almost every time: it re-ran because
 * an input changed, computed, compared equal to its last value and told
 * nobody — the run was pure cost. `costs().wastedMs` sums this; the finding
 * names it while it happens, with the input that keeps triggering it. The
 * fix is upstream: an equality boundary on the part of the input the scope
 * depends on, or a narrower read. Plain runs only — a held or overlay run
 * may be replayed and is never blamed as waste.
 */
function checkWastedRecompute(
  el: Computed<any>,
  at: number,
  phase: RerunEvent["phase"],
  changed: boolean,
  selfMs: number,
  causes: ChangeRecord[]
): void {
  const cfg = options.wastedRecompute;
  if (cfg === false || phase !== "plain") return;
  // This runs on every re-run: fields on the node (one property read each,
  // like hotRuns) and the run's own `at` — no clock read, no map lookup.
  const node = el as AttributedNode;
  if (node._devWasteWinStart === undefined || at - node._devWasteWinStart > cfg.windowMs) {
    node._devWasteWinStart = at;
    node._devWasteRuns = 0;
    node._devWasted = 0;
    node._devWastedMs = 0;
    node._devWasteWarned = false;
  }
  node._devWasteRuns = node._devWasteRuns! + 1;
  if (!changed) {
    node._devWasted = node._devWasted! + 1;
    node._devWastedMs = node._devWastedMs! + selfMs;
  }
  if (
    node._devWasteWarned ||
    node._devWasteRuns < cfg.minRuns ||
    node._devWasted! / node._devWasteRuns < cfg.ratio ||
    node._devWastedMs! < cfg.budgetMs
  )
    return;
  node._devWasteWarned = true;
  const win = { runs: node._devWasteRuns, wasted: node._devWasted!, wastedMs: node._devWastedMs! };
  const rootCause = causes.map(c => `"${c.name}" (${c.kind})`).join(", ");
  const message =
    `[WASTED_RECOMPUTE] ${nodeKind(el)} "${nodeName(el)}" re-ran ${win.runs} times in ` +
    `${cfg.windowMs}ms and ${win.wasted} of those produced the same value — ` +
    `${win.wastedMs.toFixed(1)}ms of compute the equality gate then discarded. Its inputs ` +
    `change without changing its result: put an equality boundary upstream (a memo over the ` +
    `part of the input it reads, or an \`equals\` on the source), or read a narrower slice ` +
    `(the property, not the object). Latest cause: ${rootCause || "(untracked pull)"}`;
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "WASTED_RECOMPUTE",
        kind: "perf",
        severity: "warn",
        message,
        nodeName: nodeName(el),
        data: {
          runs: win.runs,
          wasted: win.wasted,
          wastedMs: win.wastedMs,
          windowMs: cfg.windowMs,
          causes: causes.map(c => c.name)
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
  const node = el as AttributedNode;
  const prevCauses = node._devRunCauses;
  const interaction = frame.interaction;
  if (excludedNode(el)) {
    // The observer's own computation: keep the per-node bookkeeping its
    // effect phase reads (see effectRunStart) and record nothing.
    node._devRunInteraction = interaction;
    node._devRunSeq = undefined;
    node._devRunCauses = causes;
    return;
  }
  // The facts every run leaves on the node, record or not: the run sequence
  // (`ChangeOrigin.run` joins an effect-phase write to it), the run count,
  // and what the effect phase inherits — it runs later in the flush with no
  // cause list of its own, so it takes this run's interaction and causes
  // (see effectRunStart / pushFrame).
  const run = ++runSeq;
  const nodeRuns = (node._devRunCount = (node._devRunCount ?? 0) + 1);
  node._devRunInteraction = interaction;
  node._devRunSeq = run;
  node._devRunCauses = causes;
  noteInteractionRun(interaction, timing.selfMs, false);
  if (openFlush !== null) noteFlushRun(openFlush, false, interaction);
  // The checks read the facts, not the record, so they run with or without
  // an audience for it.
  const kind = nodeKind(el);
  if (kind === "effect") checkEffectCycle(el, causes);
  checkRelayTear(el, causes, prevCauses);
  checkHotRuns(el, causes);
  checkHotTime(el, timing.selfMs, causes);
  checkWastedRecompute(el, frame.start, phase, changed, timing.selfMs, causes);
  checkDepWidth(el);
  // The record: built only when something wanted it at run start (see
  // `wantsRerun`) — a listener, a fold, the log.
  const prevDeps = frame.prevDeps;
  if (prevDeps === null) return;
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
    run,
    at: frame.start,
    nodeRuns,
    nodeKind: kind,
    nodeName: nodeName(el),
    nodeId: devId(el),
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
  if (interaction !== undefined) event.interaction = interaction;
  history.push(event);
  if (history.length > options.historyLimit) history.shift();
  for (const f of folds) f.rerun?.(el, event);
  records.emit("rerun", event, el);
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

/**
 * The engine: turn it on and read its ring buffers. Its records are
 * delivered on the core's channel — `OBSERVE.records.subscribe("rerun" |
 * "hold" | "interaction" | "navigation" | "create" | "effect" | "flush" |
 * "flight" | "fallback" | "graph", (event, live) => …)` — the same place
 * the runtimes' records arrive, so a consumer has one subscribe. The folds
 * over those records — `costs()`, `feedback()` — and the point queries —
 * `why()`, `subscriptions()` — and the formatters — `formatRerun()`,
 * `formatOrigin()` — are named exports of `@solidjs/signals/attribution`
 * rather than methods here, so a consumer that only wants records (a
 * production adapter) does not ship the tables a console or an agent reads;
 * importing a fold is what turns its accounting on.
 */
export interface Attribution {
  /**
   * Install the engine, or take one more hold on it, and return the release
   * for that hold. The engine is shared by every consumer in the page — a
   * profiler track, an APM adapter, a diagnostics capture — so each
   * `enable()` is a hold: the first installs the hooks and resets
   * everything; one taken while already enabled opens a fresh window over
   * the ring buffers and folds (`history(type)`, `costs()`, `feedback()` …
   * read from here on) without disturbing the live tracking state or
   * anyone's subscriptions, so a capture begun beside a running consumer
   * still measures only its own scenario.
   *
   * Options combine across holds by the most demanding value per key: a
   * hold's `opts` say what it wants (the defaults fill what it leaves
   * unsaid), and the engine does whatever any holder asked for — the log
   * prints while any holder wants it, a check runs while any holder wants
   * it and at the most sensitive threshold requested, `historyLimit` is the
   * largest. A hold can add to what another asked for, never take it away,
   * so the result does not depend on the order holds were taken; releasing
   * a hold withdraws its requests — a track enabled with `log: false` beside
   * a console session never silences it, and a capture with tight
   * thresholds beside a records-only adapter runs the checks for its own
   * duration. The release is idempotent; the last release uninstalls the
   * hooks and clears every ring buffer. A consumer that re-`enable()`s to
   * reopen its window must release both holds (or `disable()`).
   *
   * Subscriptions are not the engine's: its records arrive on
   * `OBSERVE.records`, whose listeners outlive any hold — subscribe before
   * or after `enable()`, and unsubscribe with the function `subscribe`
   * returned.
   */
  enable(opts?: AttributionOptions): () => void;
  /**
   * Tear the engine down whatever holds are outstanding: drops every hold,
   * uninstalls the hooks and clears every ring buffer. The console's and a
   * test harness's reset — a consumer sharing the page with others releases
   * its own hold with the function `enable()` returned instead. Idempotent;
   * a `disable()` with nothing enabled is a no-op reset. Listeners on
   * `OBSERVE.records` are untouched: they are the channel's.
   */
  disable(): void;
  /**
   * The ring buffer of `type` since `enable()` — the last `historyLimit`
   * records (default 200), oldest first; the same objects the channel
   * delivered. Facts, not verdicts: each is recorded regardless of the
   * thresholds the findings apply to it.
   *
   * - `"rerun"` — every re-run recorded (see `RerunEvent`). Kept only while
   *   a record had an audience — a `rerun` listener, an imported fold
   *   (`costs`/`feedback`), or the console log; a records-only consumer
   *   that wants none of those pays for none, and reads an empty buffer.
   * - `"waterfall"` — every graph-provable sequential flight chain, warned
   *   or not: the ASYNC_WATERFALL finding is the duration-gated view.
   * - `"hold"` — every settled transition hold that staged at least one root
   *   write, acknowledged or not: SILENT_HOLD / LONG_HOLD are the
   *   thresholded verdicts (`HoldEvent.silent` / `.long` carry them).
   * - `"navigation"` — every navigation a router declared via `withOrigin`,
   *   settled or not: what route, under which interaction, how many writes,
   *   and — once its writes are through — how long that took and how
   *   (`committed`, `held` with the `HoldEvent` attached, `superseded`).
   * - `"interaction"` — every user interaction a runtime declared via
   *   `withInteraction`, settled or not: what was dispatched, when, what it
   *   wrote, the re-runs and creations it caused, the holds its writes
   *   waited in and the navigations it performed — and, once through, how
   *   long the person waited (`settledMs`) and how it ended. The
   *   per-dispatch record `feedback().interactions` folds by name.
   */
  history<K extends HistoryType>(type: K): readonly HistoryRecords[K][];
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
/** @internal The id the engine's records name `node` by, if it has one yet — read without assigning. */
export function nodeIdOf(node: object): number | undefined {
  return devIds.get(node);
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
  if (origin !== undefined) noteEffectOrigin(origin);
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
  prevTotal: number,
  owner: Owner | null | undefined
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
  // The subject is the store's own owner, not the writer's context: the
  // finding is about the store, and its writes legitimately arrive from
  // outside the graph (an event handler, an adapter). Falls back to the
  // ambient context (emitDiagnostic's default) when the store recorded none.
  const entry = emitDiagnostic(
    {
      code: "IMMUTABLE_UPDATE_IN_STORE",
      kind: "perf",
      severity: "warn",
      message,
      nodeName: path,
      data: { path, shape, total, unchanged: same, changed }
    },
    owner
  );
  // Paths are not unique across stores: an excluded owner's store (an
  // adapter's own "store.list") must not spend the app's once-per-path slot.
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
// `history("waterfall")`); the ASYNC_WATERFALL diagnostic is the derived verdict.
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

/**
 * The nearest enclosing frame with causes: create runs carry null (a node
 * born inside a parent's recompute inherits the parent's causality — the
 * boundary-reveal case, and the lazy sibling whose first pull is gated behind
 * an earlier not-ready read), so walk down to the first re-run frame.
 */
function enclosingCauses(): ChangeRecord[] | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const causes = frames[i].causes;
    if (causes !== null) return causes;
  }
  return null;
}

/** The flight's face as a record, at the moment it landed or was superseded. */
function emitFlight(
  el: Computed<any>,
  flight: LiveFlight,
  endedAt: number,
  outcome: FlightEvent["outcome"]
): void {
  if (excludedNode(el)) return;
  const event: FlightEvent = {
    nodeId: devId(el),
    nodeName: nodeName(el),
    at: flight.origin,
    durationMs: endedAt - flight.origin,
    outcome
  };
  const path = ownerPath(el);
  if (path !== undefined) event.ownerPath = path;
  if (flight.interaction !== undefined) event.interaction = flight.interaction;
  records.emit("flight", event, el);
}

function trackFlightStart(el: Computed<any>, flight: object): void {
  const at = now();
  const origin = flightOrigins.get(flight) ?? at;
  if (origin === at) flightOrigins.set(flight, at);
  // Census: a flight still in the air when the node starts another was
  // superseded — its answer will be discarded.
  const superseded = liveFlights.get(el);
  for (const f of folds) f.flightStart?.(el, superseded !== undefined);
  if (superseded !== undefined) {
    if (records.observed("flight")) emitFlight(el, superseded, at, "abandoned");
    checkAbandonedFlights(el, superseded);
  }
  const causes = enclosingCauses();
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
  for (const f of folds) f.flightLanded?.(el, ms);
  if (records.observed("flight")) emitFlight(el, flight, landedAt, "landed");
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
   * same object as `NavigationEvent.origin`, so the two join by identity.
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
  /**
   * The engine's silent-hold verdict, stamped at settle: no affordance
   * acknowledged the wait (`acknowledgements` empty) and nothing painted
   * while it was open (`paintedDuringHold === 0`). Duration-free — the
   * SILENT_HOLD finding is this above `holds.infoMs` — so a consumer can
   * flag every silent wait or apply its own floor, and a record that left
   * the process still carries the verdict.
   */
  silent: boolean;
  /**
   * The engine's long-hold verdict, stamped at settle: the quiescent tail
   * (`tailMs`) reached `longHolds.infoMs` under the options in effect;
   * `false` when long-hold tracking is off. The LONG_HOLD finding is this
   * verdict, tiered by `warnMs`.
   */
  long: boolean;
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

/** Companions are optimistic nodes too; `_parentSource` marks them. So is a
 * memo carrying a DERIVED override (lanes stage, #3479) — a lane pass's
 * result, not a write anyone made: neither is an acknowledgement. */
function isCompanion(node: Signal<any> | Computed<any>): boolean {
  return (
    (!!node._x && node._x._parentSource !== undefined) ||
    (node._config & CONFIG_DERIVED_OVERRIDE) !== 0
  );
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
  const tailMs = lastJoinAt === -Infinity ? holdMs : Math.min(holdMs, end - lastJoinAt);
  const acknowledgements = [...state.acknowledgements.values()];
  // The verdicts, stamped on the record so a consumer — in-process or
  // offline — applies the engine's own tiering rather than a threshold of
  // its own: silent is duration-free (the finding adds the floor); long is
  // the tail against `longHolds.infoMs` as the options stand at settle.
  const longCfg = options.longHolds;
  const event: HoldEvent = {
    at,
    holdMs,
    tailMs,
    flushes: state.flushes,
    heldWrites,
    blockers: [...state.blockers].map(nodeName),
    acknowledgements,
    paintedDuringHold: state.painted,
    action: state.action,
    silent: state.painted === 0 && acknowledgements.length === 0,
    long: longCfg !== false && longCfg !== undefined && tailMs >= longCfg.infoMs
  };
  if (interaction !== undefined) event.interaction = interaction;
  if (origin !== undefined) event.origin = origin;
  holdLog.push(event);
  if (holdLog.length > options.historyLimit) holdLog.shift();
  // Bottom-up delivery: the hold, then the navigations it held, then the
  // interactions those belong to — each record complete when its parent is.
  // `live` is the first held root write's signal: the subject the findings
  // below name.
  records.emit("hold", event, subject!);
  checkStackedHolds(t, event, subject!);
  settleNavigations(t, event);
  settleInteractionsHeld(t, event);
  for (const f of folds) f.hold?.(event);
  if (event.silent) checkSilentHold(event, subject!);
  else checkLongHold(event, subject!);
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
  const long = event.long;
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

/**
 * The person saw the guess, then the correction. An optimistic value is a
 * promise the UI makes about the outcome; when the outcome differs — the
 * action failed and the override lifted back to the old value, or the
 * source answered with something else — the screen changes twice for one
 * intent. Expected on failure and correct by construction (the override
 * reverts; that is the feature), so `info`: a count that grows for one
 * source is what says the guess, or the failure rate, is wrong. Judged by
 * the node's own equality, so a structurally equal replacement is not a
 * revert.
 */
function checkOptimisticRevert(
  el: Signal<any> | Computed<any>,
  shown: unknown,
  truth: unknown,
  how: "superseded" | "reverted"
): void {
  // The runtime's own optimistic nodes are not guesses the person saw: an
  // `isPending()` companion goes true while pending and back to false at
  // commit by design — the acknowledgement SILENT_HOLD asks for — and a
  // derived override promotes rather than reverts. Same predicate the hold
  // census uses to skip them.
  if (!options.optimisticReverts || isCompanion(el)) return;
  const equals = (el as { _equals?: false | ((a: unknown, b: unknown) => boolean) })._equals;
  if (equals && equals(shown, truth)) return;
  const source = nodeName(el);
  const message =
    `[OPTIMISTIC_REVERTED] the optimistic value of ${source} showed ${preview(shown)}; it ` +
    `${how === "superseded" ? "settled to" : "reverted to"} ${preview(truth)}. The person saw ` +
    `the guess, then the correction. A revert on failure is the feature; one that recurs says ` +
    `the guess is wrong for this input or the action fails often — show the failure where the ` +
    `value renders (the action's catch, an Errored boundary) rather than letting the value ` +
    `snap back on its own.`;
  emitDiagnostic(
    {
      code: "OPTIMISTIC_REVERTED",
      kind: "responsiveness",
      severity: "info",
      message,
      nodeName: source,
      data: { source, shown: preview(shown), truth: preview(truth), how }
    },
    el
  );
}

// --- Graph growth -----------------------------------------------------------------

/** Per route: the graph's size at its last `visits` settles, oldest first. */
const routeCounts = new Map<string, GraphSize[]>();

/**
 * The live graph's size — a walk, not a counter: nothing is charged at node
 * creation, disposal, write or re-run; the engine asks at a navigation's
 * settle. Two passes. The owner tree from the registered top-level roots
 * gives `owners` and seeds the computations. Then each computation's
 * dependency links give `edges` and the `signals` and computations they
 * reach, and each newly met source's subscriber list gives the computations
 * that read it — including one created with no owner, which no chain holds
 * and only its sources keep alive: the subscription leak a heap snapshot
 * finds. Measured at 5–10 ns per link; a 50k-owner graph walks in under a
 * millisecond. Dormant nodes are spliced out of their chain and are not
 * counted unless a subscription still reaches them.
 */
export function graphSize(): GraphSize {
  const roots = liveRootOwners();
  const size: GraphSize = { roots: roots.length, owners: 0, computations: 0, signals: 0, edges: 0 };
  const seen = new Set<object>();
  // A worklist, not recursion: a subscriber chain can be thousands deep.
  const work: (Signal<any> | Computed<any>)[] = [];
  const stack: Owner[] = [];
  const meet = (node: Signal<any> | Computed<any>): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (typeof (node as Computed<any>)._fn === "function") size.computations++;
    else size.signals++;
    work.push(node);
  };
  for (const root of roots) {
    size.owners++;
    // Iterative: a deep tree must not grow the call stack.
    let child = root._firstChild;
    for (;;) {
      while (child !== null) {
        size.owners++;
        if (typeof (child as Computed<any>)._fn === "function") meet(child as Computed<any>);
        if (child._firstChild !== null) stack.push(child);
        child = child._nextSibling;
      }
      const next = stack.pop();
      if (next === undefined) break;
      child = next._firstChild;
    }
  }
  for (let i = 0; i < work.length; i++) {
    const node = work[i];
    // Whoever reads this node: owned computations are already known; an
    // ownerless one is met only here.
    for (let s = node._subs; s !== null; s = s._nextSub) meet(s._sub);
    if (typeof (node as Computed<any>)._fn === "function")
      for (let link = (node as Computed<any>)._deps; link !== null; link = link._nextDep) {
        size.edges++;
        meet(link._dep);
      }
  }
  return size;
}

/**
 * settleNavigation: the app has finished moving to a route — count the live
 * graph. One record per settle for a listener; the growth check compares
 * this settle of the route with its previous ones. A count that climbs on
 * consecutive visits is something the previous visit left behind: a
 * `createRoot` in an effect with no dispose, a subscription a component
 * registered outside its owner. Nothing here runs per node; the walk is
 * the cost, at navigation cadence.
 */
const GRAPH_SERIES: (keyof GraphSize)[] = ["owners", "computations", "signals", "edges"];

function trackGraph(navigation: NavigationEvent): void {
  const cfg = options.graphGrowth;
  if (cfg === false && !records.observed("graph")) return;
  const size = graphSize();
  const route = navigation.name ?? navigation.to;
  const event: GraphEvent = { at: now(), ...size, navigation };
  if (route !== undefined) event.route = route;
  records.emit("graph", event, undefined);
  if (cfg === false || route === undefined) return;
  let history = routeCounts.get(route);
  if (history === undefined) routeCounts.set(route, (history = []));
  history.push(size);
  if (history.length > cfg.visits) history.shift();
  if (history.length < cfg.visits) return;
  // Any series climbing on every visit to the ratio is growth; which ones
  // did says what leaked — computations with owners flat is an ownerless
  // effect per visit, edges alone is a subscription per visit to something
  // long-lived, owners is an undisposed root.
  const grew = GRAPH_SERIES.filter(key => {
    for (let i = 1; i < history!.length; i++)
      if (history![i][key] <= history![i - 1][key]) return false;
    return history![history!.length - 1][key] >= history![0][key] * cfg.ratio;
  });
  if (grew.length === 0) return;
  // The count is the whole graph's, so a leak shows at every route's settle;
  // the first route to complete its climb reports, naming the others seen.
  const routes = [...routeCounts.keys()];
  const series = grew.map(key => `${key} ${history!.map(h => h[key]).join(" → ")}`).join("; ");
  const shape = grew.includes("owners")
    ? "a createRoot() in an effect or handler with no dispose, or a Portal or panel mounted per visit"
    : grew.includes("computations")
      ? "an effect or memo created with no owner (a module-level or callback createEffect) that only its sources keep alive"
      : "a subscription per visit to something long-lived — a global store or signal read by a computation that outlives the visit";
  const message =
    `[GRAPH_GROWTH] the live graph grew on ${cfg.visits} consecutive visits to ${route}: ${series} ` +
    `(${size.roots} roots)${routes.length > 1 ? `, across visits to ${routes.join(", ")}` : ""}. Each ` +
    `visit left something behind that the next did not reclaim — the shape says ${shape}. Dispose ` +
    `what a visit creates (onCleanup, or return the disposer from onSettled) and own it under the ` +
    `route's component so leaving the route tears it down.`;
  const data: Record<string, unknown> = {
    route,
    grew,
    history: history.map(h => ({ ...h })),
    roots: size.roots,
    routes
  };
  if (navigation.interaction !== undefined)
    data.interaction = { type: navigation.interaction.name, target: navigation.interaction.target };
  reportDiagnostic(
    emitDiagnostic({ code: "GRAPH_GROWTH", kind: "perf", severity: "warn", message, data }, null)
  );
  // Judged once for the graph, not once per route: the next verdict needs
  // another `visits` climbing settles.
  routeCounts.clear();
}

// --- Feedback-table findings -----------------------------------------------------

/** Per async source: abandoned flights inside the current window. Engine-side; the node carries nothing. */
const abandonWindows = new WeakMap<
  Computed<any>,
  { start: number; count: number; warned: boolean }
>();

/**
 * One source abandoning flight after flight inside a window: every input
 * asked again and the earlier answers were thrown away — the
 * request-per-keystroke signature `feedback().flights[].abandoned` counts,
 * as a finding while it happens. Warned once per window per source.
 */
function checkAbandonedFlights(el: Computed<any>, abandoned: LiveFlight): void {
  const cfg = options.abandonedFlights;
  if (cfg === false || excludedNode(el)) return;
  const at = Date.now();
  let win = abandonWindows.get(el);
  if (win === undefined || at - win.start > cfg.windowMs) {
    win = { start: at, count: 0, warned: false };
    abandonWindows.set(el, win);
  }
  win.count++;
  if (win.warned || win.count < cfg.count) return;
  win.warned = true;
  const source = nodeName(el);
  const who =
    abandoned.interaction !== undefined
      ? ` (${formatOrigin(abandoned.interaction)} started the first)`
      : "";
  const message =
    `[ABANDONED_FLIGHTS] "${source}" abandoned ${win.count} flights in ${cfg.windowMs}ms` +
    `${who}: each was superseded by the next before it landed, so every input asked again and the ` +
    `answers were discarded. Put a debounced or equality-gated derivation between the input and ` +
    `the fetch, or key the fetch on what changes rather than on every keystroke; a preload the ` +
    `flights share (markFlight) reads as one flight, not many.`;
  const data: Record<string, unknown> = {
    source,
    abandoned: win.count,
    windowMs: cfg.windowMs
  };
  if (abandoned.interaction !== undefined)
    data.interaction = { type: abandoned.interaction.name, target: abandoned.interaction.target };
  const entry = emitDiagnostic(
    {
      code: "ABANDONED_FLIGHTS",
      kind: "responsiveness",
      severity: "warn",
      message,
      nodeName: source,
      data
    },
    el
  );
  reportDiagnostic(entry);
}

/**
 * A fallback that appeared and vanished: the other end of the SILENT_HOLD
 * spectrum — feedback for a wait too short to need it, which reads as a
 * flicker. `info`, once per flash; `feedback().fallbacks[].flashes` is the
 * count. The repair is a preload, a cache, or lifting the fetch above the
 * boundary so the data is there before the boundary asks.
 */
function checkFallbackFlash(
  subtree: Computed<any> | undefined,
  shownMs: number,
  interaction: ChangeOrigin | undefined
): void {
  if (subtree !== undefined && excludedNode(subtree)) return;
  const where = subtree !== undefined ? ownerPath(subtree)?.join(" › ") : undefined;
  const who = interaction !== undefined ? `${formatOrigin(interaction)}: ` : "";
  const message =
    `[FALLBACK_FLASH] ${who}the Loading fallback${where ? ` at ${where}` : ""} showed for ` +
    `${shownMs.toFixed(0)}ms — a spinner that appeared and vanished, feedback for a wait too short ` +
    `to need it. Preload or cache the data so it is there before the boundary asks, or lift the ` +
    `read above the boundary; a fallback under ${FALLBACK_FLASH_MS}ms reads as a flicker.`;
  const data: Record<string, unknown> = { shownMs };
  if (interaction !== undefined)
    data.interaction = { type: interaction.name, target: interaction.target };
  emitDiagnostic(
    { code: "FALLBACK_FLASH", kind: "responsiveness", severity: "info", message, data },
    subtree ?? null
  );
}

/**
 * Several interactions waiting in one hold when it commits: the person kept
 * clicking or typing while the first answer was in the air, and all of them
 * waited on the same source. The pile is the symptom; the hold's own verdict
 * (SILENT_HOLD / LONG_HOLD) is the cause, so the repair is the same
 * acknowledgement, plus a control that does not accept the repeat.
 */
function checkStackedHolds(t: Transition, hold: HoldEvent, subject: Signal<any>): void {
  const cfg = options.stackedHolds;
  if (cfg === false) return;
  let stacked = 0;
  for (const state of openInteractions) if (state.heldIn.has(t)) stacked++;
  if (stacked < cfg.count) return;
  const waitedOn = describeBlockers(hold, "waiting on");
  const message =
    `[STACKED_HOLDS] ${stacked} interactions queued behind one hold${waitedOn} for ` +
    `${hold.holdMs.toFixed(0)}ms: the person kept ${hold.interaction?.name === "input" ? "typing" : "clicking"} ` +
    `while the first answer was in the air, and every repeat waited on the same source. ` +
    `Acknowledge the wait where the control is (isPending() to disable or dim it) so the repeats ` +
    `stop, or debounce the input; the hold itself is judged by SILENT_HOLD/LONG_HOLD.`;
  const data = holdData(hold);
  data.interactions = stacked;
  const entry = emitDiagnostic(
    {
      code: "STACKED_HOLDS",
      kind: "responsiveness",
      severity: "warn",
      message,
      nodeName: nodeName(subject),
      data
    },
    subject
  );
  reportDiagnostic(entry);
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
  ref: NavigationRef;
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

function openNavigation(frame: ChangeOrigin, ref: NavigationRef): void {
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
function redirectNavigation(state: NavState, ref: NavigationRef): void {
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

// --- Flushes ---------------------------------------------------------------------
//
// The drain the scheduler is running, while a `flush` listener wants it: the
// counts accumulate from `recordRerun` and the create branch, `holdStart`
// marks it held, and `flushEnd` closes and emits it. `null` while no drain is
// open or nobody listens — the one check the hot paths pay.
interface OpenFlush {
  at: number;
  runs: number;
  created: number;
  held: boolean;
  /** The one interaction seen so far; `null` once runs for two were seen (mixed). */
  interaction: ChangeOrigin | undefined | null;
}
let openFlush: OpenFlush | null = null;

function noteFlushRun(
  flush: OpenFlush,
  create: boolean,
  interaction: ChangeOrigin | undefined
): void {
  if (create) flush.created++;
  else flush.runs++;
  if (interaction === undefined || flush.interaction === null) return;
  if (flush.interaction === undefined) flush.interaction = interaction;
  else if (flush.interaction !== interaction) flush.interaction = null;
}

function trackFlushStart(): void {
  if (!records.observed("flush")) return;
  openFlush = { at: now(), runs: 0, created: 0, held: false, interaction: undefined };
}

// --- Fallbacks -------------------------------------------------------------------
//
// A loading boundary's fallback, from display to hide, as a record. Keyed by
// the boundary object (a WeakMap — a fallback that never hides must not pin
// its boundary); `gen` stamps the show with the tracking generation so a show
// that predates a reinstall cannot emit against the new window.
//
// The show the boundary reports is the SWAP — a staged write, which lands
// with its transaction's commit (#3540: `on` follows the frame) and is on
// screen once the drain that committed it has run its effects. Until then
// the fallback is not displayed: an open is `staged` — under the transaction
// it lands with (`transitionSettled` moves it to the settling drain;
// `transitionMerged` follows a fold), or under the current drain when no
// transaction carries it, the lane swap included (its readers run in this
// drain). `flushEnd` — the "committed, screen updated" instant — stamps the
// drain's opens with their `at`. A hide that finds the open still staged was
// never displayed: the content landed before the frame did and the sweep
// cleared the swap ahead of the commit, or the commit's own sweep cleared it
// before any effect ran (the LOADING_ON_OUTSIDE_HOLD shape). It drops the
// open and makes no record, and the folds hear neither show nor hide.
interface OpenFallback {
  at: number;
  gen: number;
  /** A `fallback` listener existed at the show; the record is for it. */
  record: boolean;
  boundary: object;
  tree: Computed<any> | undefined;
  interaction: ChangeOrigin | undefined;
  /** Pending display: the transaction it lands with, or `DRAIN` for this flush's end. */
  staged: Transition | typeof DRAIN | null;
}
/** The key for swaps no transaction carries — an object, so the map below can be weak. */
const DRAIN: { readonly drain: true } = { drain: true };
const openFallbacks = new WeakMap<object, OpenFallback>();
// Weak on the transaction: one that is dropped without settling or merging
// (its boundary disposed, its queues discarded) takes its staged opens with it.
const stagedFallbacks = new WeakMap<Transition | typeof DRAIN, OpenFallback[]>();
/** Bumped by `resetTracking` — the engine's install generation. */
let trackingGen = 0;

function trackFallback(
  boundary: object,
  tree: Computed<any> | undefined,
  shown: boolean,
  transition: Transition | null
): void {
  if (shown) {
    // Folds count showings too, and the flash finding needs the show's
    // clock: an open is kept for any of the three audiences.
    const record = records.observed("fallback");
    if (!record && folds.length === 0 && options.fallbackFlashes === false) return;
    // The wait is the enclosing recompute's cause's interaction — the read
    // that registered the pending source runs inside one — else the ambient.
    const causes = enclosingCauses();
    const staged = transition ?? DRAIN;
    const open: OpenFallback = {
      at: now(),
      gen: trackingGen,
      record,
      boundary,
      tree,
      interaction: causes !== null ? interactionIn(causes) : (currentInteraction ?? undefined),
      staged
    };
    openFallbacks.set(boundary, open);
    const list = stagedFallbacks.get(staged);
    if (list === undefined) stagedFallbacks.set(staged, [open]);
    else list.push(open);
    return;
  }
  const open = openFallbacks.get(boundary);
  if (open === undefined) return;
  openFallbacks.delete(boundary);
  if (open.staged !== null) {
    // Cleared before its commit: never on screen.
    const list = stagedFallbacks.get(open.staged)!;
    list.splice(list.indexOf(open), 1);
    if (list.length === 0) stagedFallbacks.delete(open.staged);
    return;
  }
  if (open.gen !== trackingGen) return;
  // The hide has the subtree the first show may have lacked.
  const subtree = tree ?? open.tree;
  for (const f of folds) f.fallback?.(boundary, subtree, false);
  const shownMs = now() - open.at;
  if (options.fallbackFlashes !== false && shownMs < FALLBACK_FLASH_MS)
    checkFallbackFlash(subtree, shownMs, open.interaction);
  if (!open.record) return;
  const event: FallbackEvent = { at: open.at, shownMs };
  const path = subtree !== undefined ? ownerPath(subtree) : undefined;
  if (path !== undefined) event.ownerPath = path;
  if (open.interaction !== undefined) event.interaction = open.interaction;
  records.emit("fallback", event, subtree);
}

/** flushEnd: the drain's committed swaps have rendered — those fallbacks are on screen from here. */
function displayFallbacks(): void {
  const list = stagedFallbacks.get(DRAIN);
  if (list === undefined) return;
  stagedFallbacks.delete(DRAIN);
  const at = now();
  for (const open of list) {
    open.staged = null;
    open.at = at;
    if (open.gen === trackingGen)
      for (const f of folds) f.fallback?.(open.boundary, open.tree, true);
  }
}

/** transitionSettled (`from` a transaction, into this drain) and
 * transitionMerged (`from` the outgoing, into the surviving transaction):
 * the swaps staged under `from` now land with `into`. */
function rebaseFallbacks(from: Transition, into: Transition | typeof DRAIN): void {
  const list = stagedFallbacks.get(from);
  if (list === undefined) return;
  stagedFallbacks.delete(from);
  for (const open of list) open.staged = into;
  const target = stagedFallbacks.get(into);
  if (target === undefined) stagedFallbacks.set(into, list);
  else target.push(...list);
}

/** flushEnd: every open, closed, unheld navigation's (and interaction's) writes just committed. */
function trackFlushEnd(): void {
  // The drain's own record first: the interactions it settles below waited on it.
  const flush = openFlush;
  if (flush !== null) {
    openFlush = null;
    const event: FlushEvent = {
      at: flush.at,
      durationMs: now() - flush.at,
      runs: flush.runs,
      created: flush.created,
      held: flush.held
    };
    if (flush.interaction != null) event.interaction = flush.interaction;
    records.emit("flush", event, undefined);
  }
  drainSeq++;
  // The swaps this drain committed have rendered.
  displayFallbacks();
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
  for (const f of folds) f.navigation?.(event);
  records.emit("navigation", event, undefined);
  trackGraph(event);
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
  /**
   * When the interaction began (`performance.now()` clock): the browser event's
   * own timestamp when the runtime supplied it, else the moment the handler
   * frame opened. Joins `PerformanceEventTiming.startTime` for the same event.
   */
  at: number;
  /**
   * Browser event creation to handler entry (ms) — the queueing the browser's
   * INP counts as input delay. Present only when `at` predates the frame.
   */
  inputDelayMs?: number;
  /** Wall time of the handler itself, entry to return. */
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
   * The handler returned a thenable (`async () => { await save(); … }`) and
   * the record waited for it: handler return → the promise settling, in
   * milliseconds, capped at `ASYNC_HANDLER_CAP_MS`. The continuation runs
   * with no frame on the stack, so writes it makes are not attributed to
   * this interaction — only its duration is. Absent when the handler
   * returned synchronously.
   */
  continuationMs?: number;
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
  /** When the frame opened — the handler's actual start; `event.at` may predate it. */
  opened: number;
  /** `drainSeq` at its last write — a later drain committed it. */
  writeDrain: number;
  /** Transitions currently holding at least one of its writes. */
  heldIn: Set<Transition>;
  /** A flush parked its writes at some point (hold tracking on or off). */
  held: boolean;
  /** Root writes to excluded subjects (the observer's own store): not the app's. */
  excludedWrites: number;
  /** The handler returned a thenable that has not settled; the record waits for it. */
  awaiting: boolean;
  /** An action step ran under the frame: the handler's async work is an action's, tracked as such. */
  actioned: boolean;
}
const interactionStates = new WeakMap<ChangeOrigin, InteractionState>();
/** Opened, not yet settled. */
const openInteractions = new Set<InteractionState>();
let interactionLog: InteractionEvent[] = [];

function openInteraction(frame: ChangeOrigin, opened: number): void {
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
  // The runtime may date the frame from the event's own timestamp (before
  // any queued task ran); the gap to here is the input delay the browser's
  // INP counts first.
  if (opened > event.at) event.inputDelayMs = opened - event.at;
  const state: InteractionState = {
    event,
    open: true,
    opened,
    writeDrain: drainSeq,
    heldIn: new Set(),
    held: false,
    excludedWrites: 0,
    awaiting: false,
    actioned: false
  };
  interactionStates.set(frame, state);
  openInteractions.add(state);
  interactionLog.push(event);
  if (interactionLog.length > options.historyLimit) interactionLog.shift();
}

/**
 * How long the record waits on a handler's returned promise before settling
 * without it: a promise that never settles (a hung request, a listener
 * awaiting an event that never comes) must not keep the record open forever.
 */
const ASYNC_HANDLER_CAP_MS = 10_000;

/** interactionEnd: the handler returned. */
function closeInteraction(frame: ChangeOrigin, returned?: unknown): void {
  const state = interactionStates.get(frame);
  if (state === undefined) return;
  state.open = false;
  const end = now();
  state.event.handlerMs = end - state.opened;
  // `async () => { await save(); set(…) }` returns a promise and continues
  // past the frame; the person's wait is that continuation. The record stays
  // open until it settles (or the cap), then judges whether anything on
  // screen could have shown the wait.
  const thenable =
    returned !== null &&
    (typeof returned === "object" || typeof returned === "function") &&
    typeof (returned as PromiseLike<unknown>).then === "function"
      ? (returned as PromiseLike<unknown>)
      : null;
  if (thenable !== null) {
    state.awaiting = true;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (): void => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      if (!openInteractions.has(state)) return;
      state.awaiting = false;
      const at = now();
      state.event.continuationMs = at - end;
      checkUntrackedAsyncHandler(state);
      maybeSettleInteraction(state, at);
    };
    timer = setTimeout(settle, ASYNC_HANDLER_CAP_MS);
    // A pending cap must not hold a Node process (tests, SSR harnesses) open.
    (timer as { unref?: () => void }).unref?.();
    // Both branches: a rejected handler promise still ended the wait.
    thenable.then(settle, settle);
    return;
  }
  maybeSettleInteraction(state, end);
}

/**
 * The handler awaited past its frame with nothing in the graph carrying the
 * wait: no root write before the `await` (a pending flag, an optimistic
 * value) and no action step (an action's steps stay attributed across
 * yields, and its holds are judged by SILENT_HOLD). From the person's side
 * the click did nothing for `continuationMs`; from the engine's side the
 * wait is invisible — no hold opened, so no hold could be acknowledged.
 * Thresholds are the hold thresholds: it is the same wait.
 */
function checkUntrackedAsyncHandler(state: InteractionState): void {
  const cfg = options.holds;
  if (cfg === false) return;
  const event = state.event;
  const ms = event.continuationMs!;
  if (state.actioned || event.writes > 0 || ms < cfg.infoMs) return;
  const actor = formatOrigin(event.origin);
  const message =
    `[UNTRACKED_ASYNC_HANDLER] ${actor}'s handler awaited ${ms.toFixed(0)}ms past its frame with no ` +
    `write before the await: no hold opened, so nothing on screen could show the wait — the ` +
    `interaction was dead for ${ms.toFixed(0)}ms. Make the async work an action() (its steps stay ` +
    `attributed across yields and its hold is judged), or write the pending state first: a ` +
    `createOptimistic(false) "saving" flag the UI reads.`;
  const severity = ms >= cfg.warnMs ? "warn" : "info";
  const data: Record<string, unknown> = {
    interaction: { type: event.name, target: event.target },
    continuationMs: ms,
    capped: ms >= ASYNC_HANDLER_CAP_MS
  };
  const entry = emitDiagnostic(
    { code: "UNTRACKED_ASYNC_HANDLER", kind: "responsiveness", severity, message, data },
    null
  );
  if (severity === "warn") reportDiagnostic(entry);
}

/** The open record a frame runs under, if any. */
function openInteractionOf(origin: ChangeOrigin | undefined): InteractionState | undefined {
  const interaction = interactionOf(origin);
  if (interaction === undefined) return undefined;
  const state = interactionStates.get(interaction);
  return state !== undefined && openInteractions.has(state) ? state : undefined;
}

/** stampWrite: a root write stamped `origin`. */
function noteInteractionWrite(origin: ChangeOrigin, excluded: boolean): void {
  const state = openInteractionOf(origin);
  if (state === undefined) return;
  if (excluded) {
    state.excludedWrites++;
    return;
  }
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
  if (state.open || state.awaiting || state.heldIn.size > 0) return;
  // A drain must have committed the last write (the handler's, or a redirect
  // hop's after the click's own drain) — the handler returning is not the
  // screen having it.
  if (event.writes > 0 && drainSeq <= state.writeDrain) return;
  for (const nav of event.navigations) if (nav.outcome === undefined) return;
  openInteractions.delete(state);
  // Every write went to an excluded subject and nothing of the app's ran: the
  // click was on the observer's own UI (a devtools panel's button). Not a
  // fact about the app — forget it rather than report a dead interaction.
  if (event.writes === 0 && state.excludedWrites > 0 && event.runs === 0 && event.created === 0) {
    const i = interactionLog.indexOf(event);
    if (i !== -1) interactionLog.splice(i, 1);
    return;
  }
  event.settledMs = end - event.at;
  event.outcome = event.writes === 0 ? "idle" : state.held ? "held" : "committed";
  records.emit("interaction", event, undefined);
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
  flushStart() {
    trackFlushStart();
  },
  flushEnd() {
    trackFlushEnd();
  },
  recomputeStart(el, create) {
    const causes = create ? null : collectCauses(el);
    frames.push({
      start: now(),
      childMs: 0,
      causes,
      // The record's dep diff needs the deps as they were: captured here,
      // and only when the record will have an audience (see wantsRerun).
      prevDeps: create || !wantsRerun() ? null : captureDeps(el),
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
      // The first effect callback runs with no re-run record to inherit from;
      // hand it the interaction that built the node (see effectRunStart).
      (el as AttributedNode)._devRunInteraction = frame.interaction;
      if (openFlush !== null) noteFlushRun(openFlush, true, frame.interaction);
      if (records.observed("create")) {
        const event: CreateEvent = {
          at: frame.start,
          nodeKind: nodeKind(el),
          nodeName: nodeName(el),
          nodeId: devId(el),
          depCount: captureDeps(el).length,
          selfMs,
          totalMs,
          phase: optimistic ? "optimistic" : transition ? "held" : "plain",
          held
        };
        if (frame.interaction !== undefined) event.interaction = frame.interaction;
        records.emit("create", event, el);
      }
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
    // The frame's own `at` doubles as the record's start: set only while
    // listened, so a listener arriving mid-callback finds no start and the
    // end emits nothing for it — and an unlistened callback pays no clock read.
    if (records.observed("effect")) originFrames[originFrames.length - 1].at = now();
  },
  effectRunEnd(el) {
    const frame = originFrames[originFrames.length - 1];
    if (frame !== undefined && frame.kind === "effect" && frame.at !== undefined) {
      if (!excludedNode(el)) {
        const event: EffectRunEvent = {
          at: frame.at,
          durationMs: now() - frame.at,
          nodeId: devId(el),
          nodeName: nodeName(el)
        };
        if (frame.run !== undefined) event.run = frame.run;
        if (frame.interaction !== undefined) event.interaction = frame.interaction;
        records.emit("effect", event, el);
      }
    }
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
      // The handler's async work is an action's: tracked across yields.
      const state = interaction !== undefined ? interactionStates.get(interaction) : undefined;
      if (state !== undefined) state.actioned = true;
    }
    pushFrame("action", name, interaction);
  },
  actionStepEnd() {
    popFrame("action");
  },
  holdStart(t) {
    if (openFlush !== null) openFlush.held = true;
    trackHoldStart(t);
  },
  holdEnd() {
    activeHold = null;
  },
  transitionSettled(t) {
    trackHoldSettled(t);
    rebaseFallbacks(t, DRAIN);
  },
  transitionMerged(target, outgoing) {
    trackHoldMerge(target, outgoing);
    rebaseFallbacks(outgoing, target);
  },
  storeReplaced(path, isArray, total, unchanged, prevTotal, owner) {
    checkImmutableUpdate(path, isArray, total, unchanged, prevTotal, owner);
  },
  listChurn(el, removed, created, newLen, keyed) {
    checkListIdentity(el, removed, created, newLen, keyed);
  },
  boundaryFallback(boundary, tree, shown, transition) {
    // The folds hear the show at its display (see trackFallback), not here.
    trackFallback(boundary, tree, shown, transition ?? null);
  },
  optimisticReverted(el, shown, truth, how) {
    checkOptimisticRevert(el, shown, truth, how);
  },
  currentOrigin() {
    return ambientOrigin();
  }
};

/**
 * Outstanding `enable()` holds. The engine is one per process and shared by
 * every consumer on the page; it stays installed while any hold remains, and
 * the options in effect are the holds' requests combined (see `applyOptions`).
 */
interface Hold {
  opts: AttributionOptions | undefined;
}
const holds: Hold[] = [];

/**
 * The windows: what a consumer reads back — the ring buffers, the once-only
 * warning memories (so a new window can warn again), the hot-cause windows,
 * the folds' tables. Reset by every `enable()` (each opens a fresh window)
 * and by the last `disable()`. Never touches the live tracking state —
 * open frames, open interactions and navigations, the active hold,
 * `drainSeq` — which belongs to whoever is mid-flight when a second
 * consumer arrives.
 */
function resetWindows(): void {
  history = [];
  waterfallLog = [];
  holdLog = [];
  navigationLog = [];
  interactionLog = [];
  reportedCycles.clear();
  relays.clear();
  immutableReported.clear();
  hotCauses.clear();
  for (const f of folds) f.reset?.();
}

/** The live tracking state — reset only when the engine is (un)installed. */
function resetTracking(): void {
  frames.length = 0;
  activeHold = null;
  openFlush = null;
  stagedFallbacks.delete(DRAIN);
  trackingGen++;
  openNavs.clear();
  openInteractions.clear();
  routeCounts.clear();
  drainSeq = 0;
  originFrames.length = 0;
  effectStack.length = 0;
  interactionStack.length = 0;
  currentInteraction = null;
}

type Options = typeof defaultOptions;

/**
 * One hold's request in full: the defaults for what it left unsaid (an
 * explicit `undefined` is unsaid), and `checks: false` folding its five cost
 * checks off before anyone else's request is considered.
 */
function resolveHold(opts: AttributionOptions | undefined): Options {
  const out: Options = { ...defaultOptions };
  if (opts !== undefined) {
    for (const key of Object.keys(opts) as (keyof AttributionOptions)[]) {
      const value = opts[key];
      if (value !== undefined) (out as Record<string, unknown>)[key] = value;
    }
  }
  if (!out.checks) {
    out.hotRuns = false;
    out.hotTime = false;
    out.wideDeps = false;
    out.unstableMemos = false;
    out.fanOut = false;
    out.wastedRecompute = false;
  }
  return out;
}

/**
 * The more demanding of two settings for one key: `true` over `false`, the
 * larger `historyLimit`, a threshold config over `false`, and between two
 * configs the field values that fire sooner — the lower count, budget or
 * millisecond bound, the longer `windowMs`.
 */
function demanding(key: keyof Options, a: unknown, b: unknown): unknown {
  if (typeof a === "boolean") return a || b;
  if (key === "historyLimit") return Math.max(a as number, b as number);
  if (a === false) return b;
  if (b === false) return a;
  if (typeof a === "number") return Math.min(a, b as number);
  const out: Record<string, number> = {};
  for (const field in a as Record<string, number>) {
    const x = (a as Record<string, number>)[field];
    const y = (b as Record<string, number>)[field];
    out[field] = field === "windowMs" ? Math.max(x, y) : Math.min(x, y);
  }
  return out;
}

/**
 * Recompute the options in effect: each live hold's request resolved, then
 * combined per key by the most demanding value — the one that has the
 * engine observe more, report more or keep more. A hold says what it wants
 * and can only add to what another hold asked for, never take it away, so
 * the result does not depend on the order the holds were taken: the console
 * log prints while any holder wants it, a check runs while any holder wants
 * it and at the most sensitive threshold anyone asked for, the ring buffer
 * is the largest requested. With no hold outstanding the defaults stand.
 */
function applyOptions(): void {
  if (holds.length === 0) {
    options = { ...defaultOptions };
    return;
  }
  const out = resolveHold(holds[0].opts) as Record<string, unknown>;
  for (let i = 1; i < holds.length; i++) {
    const next = resolveHold(holds[i].opts) as Record<string, unknown>;
    for (const key in out) out[key] = demanding(key as keyof Options, out[key], next[key]);
  }
  options = out as Options;
}

/** The last hold is gone (or `disable()` was called): uninstall and clear everything. */
function uninstall(): void {
  holds.length = 0;
  applyOptions();
  attributionActive = false;
  resetWindows();
  resetTracking();
  setAttributionHooks(null);
}

export const attribution: Attribution = {
  enable(opts?: AttributionOptions) {
    const hold: Hold = { opts };
    holds.push(hold);
    applyOptions();
    resetWindows();
    if (!attributionActive) {
      attributionActive = true;
      resetTracking();
      setAttributionHooks(engineHooks);
    }
    return () => {
      const i = holds.indexOf(hold);
      if (i === -1) return;
      holds.splice(i, 1);
      if (holds.length === 0) uninstall();
      else applyOptions();
    };
  },
  disable() {
    uninstall();
  },
  history(type: HistoryType) {
    let buffer: readonly unknown[];
    switch (type) {
      case "rerun":
        buffer = history;
        break;
      case "waterfall":
        buffer = waterfallLog;
        break;
      case "hold":
        buffer = holdLog;
        break;
      case "navigation":
        buffer = navigationLog;
        break;
      case "interaction":
        buffer = interactionLog;
        break;
      default:
        throw new Error(`attribution.history: unknown record type "${String(type)}"`);
    }
    // The buffers are typed by their variable; the switch is the proof.
    return buffer as readonly never[];
  },
  markFlight(flight: object, startedAt: number = now()) {
    // Earliest wins: re-marking (a cache re-serving the same promise) must
    // not move the origin later.
    const existing = flightOrigins.get(flight);
    if (existing === undefined || startedAt < existing) flightOrigins.set(flight, startedAt);
  }
};
