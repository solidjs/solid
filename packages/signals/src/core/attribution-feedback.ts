/**
 * `feedback()` — what the user waited on, as ranked tables. Folded from the
 * records the engine already keeps (holds, the interaction on each re-run,
 * navigations) and two censuses the engine reports as they happen (flights
 * started/landed/abandoned per async source; fallback shows per boundary).
 *
 * Its own module on purpose: the tables register with the engine's fold seam
 * when this module is evaluated, so an observe-tier consumer that only
 * subscribes to records never ships them. Reset with the engine on
 * `enable()`/`disable()`.
 */
import {
  FALLBACK_FLASH_MS,
  formatOrigin,
  nodeName,
  now,
  registerFold,
  type ChangeOrigin,
  type HoldEvent,
  type NavigationEvent,
  type RerunEvent
} from "./attribution.js";
import { ownerPath } from "./dev.js";
import type { Computed } from "./types.js";

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
  const silent = event.silent;
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
  if (event.long) {
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
    if (event.hold !== undefined && event.hold.silent) row.silent++;
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

registerFold({
  rerun: (_el, event) => recordFeedbackRun(event),
  hold: recordFeedbackHold,
  navigation: recordFeedbackNavigation,
  flightStart(el, abandoned) {
    const stats = flightBucket(el);
    stats.flights++;
    if (abandoned) stats.abandoned++;
  },
  flightLanded(el, ms) {
    const stats = flightBucket(el);
    stats.landed++;
    stats.landedMs += ms;
    if (ms > stats.worstMs) stats.worstMs = ms;
  },
  fallback: trackFallback,
  reset() {
    feedbackSources.clear();
    feedbackInteractions.clear();
    feedbackNavigations.clear();
    flightStats.clear();
    fallbackStats.clear();
  }
});

/**
 * What the user waited on, folded from holds and the interaction on each
 * re-run: `sources` ranks async sources by the silent time writes spent held
 * behind them (with which affordances answered, how often, and which
 * interactions were held); `interactions` ranks user events by the total time
 * they cost — re-run work caused (long-flush hazard) beside time held
 * (silent-hold hazard). Facts at every duration; SILENT_HOLD is the
 * thresholded verdict. Three more tables round out the picture: `navigations`
 * ranks routes by the time spent held navigating to them (folded from settled
 * navigations), `flights` counts each async source's flights and how many
 * were abandoned before landing (the re-ask storm), and `fallbacks` measures
 * how long each loading boundary showed its fallback and how often that was a
 * flash.
 */
export function feedback(): AttributionFeedbackTables {
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
