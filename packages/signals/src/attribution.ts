/**
 * `@solidjs/signals/attribution` — the "why did this run" engine.
 *
 * A separate entry on purpose: the core ships only the hook slot
 * (`OBSERVE.attribution.install`) and the interaction frame
 * (`OBSERVE.attribution.withInteraction`); the engine that turns hook facts
 * into re-run explanations, cost tables, holds and feedback lives here, so an
 * observe build carries it only when something imports this module. The dev
 * and observe tiers resolve to this file; the prod tier resolves to
 * `attribution.prod.ts`, an inert engine with the same surface, so app code
 * can import it unconditionally.
 */
export { attribution, formatOrigin, formatRerun } from "./core/attribution.js";
// The folds and point queries are named exports, not methods of `attribution`:
// each fold registers its accounting with the engine when its module is
// evaluated, so a records-only consumer that never imports `costs`/`feedback`
// ships neither the tables nor the work of filling them.
export { costs } from "./core/attribution-costs.js";
export { feedback } from "./core/attribution-feedback.js";
export { subscriptions, why } from "./core/attribution-queries.js";
export type {
  Acknowledgement,
  Attribution,
  AttributionOptions,
  AttributionRecords,
  AttributionRecordType,
  ChangeKind,
  ChangeOrigin,
  ChangeRecord,
  FlightLink,
  HeldWrite,
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
export type { InteractionRef, NavigationRef, OriginRef } from "./core/attribution-hooks.js";
