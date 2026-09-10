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
export { attribution } from "./core/attribution.js";
export type {
  Attribution,
  AttributionFeedbackTables,
  AttributionOptions,
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
  NavigationEvent,
  NavigationHop,
  RerunEvent,
  ScopeCost,
  WaterfallRecord,
  WriteCost
} from "./core/attribution.js";
export type { InteractionRef, NavigationRef, OriginRef } from "./core/attribution-hooks.js";
