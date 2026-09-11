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

const EMPTY: readonly never[] = Object.freeze([]);
const noop = () => {};

export const attribution: Attribution = {
  enable: noop,
  disable: noop,
  subscribe: () => noop,
  history: () => EMPTY,
  why: () => [],
  subscriptions: () => [],
  costs: () => ({ scopes: [], writes: [] }),
  waterfalls: () => EMPTY,
  holds: () => EMPTY,
  navigations: () => EMPTY,
  interactions: () => EMPTY,
  feedback: () => ({ sources: [], interactions: [], navigations: [], flights: [], fallbacks: [] }),
  markFlight: noop,
  format: () => "",
  formatOrigin: () => ""
};

export type {
  Acknowledgement,
  Attribution,
  AttributionFeedbackTables,
  AttributionOptions,
  AttributionRecords,
  AttributionRecordType,
  ChangeKind,
  ChangeOrigin,
  ChangeRecord,
  FallbackStats,
  FeedbackInteraction,
  FeedbackNavigation,
  FeedbackSource,
  FlightLink,
  FlightStats,
  HeldWrite,
  HoldEvent,
  InteractionEvent,
  NavigationEvent,
  NavigationHop,
  RerunEvent,
  ScopeCost,
  WaterfallRecord,
  WriteCost
} from "./core/attribution.js";
export type { InteractionRef, NavigationRef, OriginRef } from "./core/attribution-hooks.js";
