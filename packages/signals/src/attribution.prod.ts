/**
 * `@solidjs/signals/attribution` as the prod tier resolves it.
 *
 * A prod build has no hook sites — `__OBSERVE__` folded every one out — so an
 * engine installed there would never hear a fact. Rather than make apps guard
 * the import per tier, prod resolves this inert twin: the same `Attribution`
 * surface, every query empty, `enable()` a no-op. Type-checked against the
 * real engine's interface so the two cannot drift.
 */
import type { Attribution } from "./core/attribution.js";
import type * as Engine from "./attribution.js";

const EMPTY: readonly never[] = Object.freeze([]);
const noop = () => {};

export const attribution: Attribution = {
  enable: () => noop,
  disable: noop,
  history: () => EMPTY,
  markFlight: noop
};

// The named surface, inert: every fold empty, every query empty, every
// formatter blank. Typed against the real entry's exports so the two cannot
// drift.
export const costs: typeof Engine.costs = () => ({ scopes: [], writes: [] });
export const feedback: typeof Engine.feedback = () => ({
  sources: [],
  interactions: [],
  navigations: [],
  flights: [],
  fallbacks: []
});
export const why: typeof Engine.why = () => [];
export const subscriptions: typeof Engine.subscriptions = () => [];
export const formatRerun: typeof Engine.formatRerun = () => "";
export const formatOrigin: typeof Engine.formatOrigin = () => "";
// Prod registers no roots: the graph has no observable size.
export const graphSize: typeof Engine.graphSize = () => ({
  roots: 0,
  owners: 0,
  computations: 0,
  signals: 0,
  edges: 0
});

export type {
  Acknowledgement,
  Attribution,
  AttributionOptions,
  ChangeKind,
  ChangeOrigin,
  ChangeRecord,
  CreateEvent,
  EffectRunEvent,
  FallbackEvent,
  FlightEvent,
  FlightLink,
  FlushEvent,
  GraphEvent,
  GraphSize,
  HeldWrite,
  HistoryRecords,
  HistoryType,
  HoldEvent,
  InteractionEvent,
  NavigationEvent,
  NavigationHop,
  RerunEvent,
  WaterfallRecord
} from "./core/attribution.js";
export type { AttributionCostTables, ScopeCost, WriteCost } from "./core/attribution-costs.js";
export type {
  AttributionFeedbackTables,
  FallbackStats,
  FeedbackInteraction,
  FeedbackNavigation,
  FeedbackSource,
  FlightStats
} from "./core/attribution-feedback.js";
