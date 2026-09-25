export { captureArtifact } from "./capture.js";
export type { CaptureOptions, CaptureResult } from "./capture.js";
export { ARTIFACT_FORMAT_VERSION, serializeArtifact, artifactToJSONL } from "./artifact.js";
export {
  DiagnosticsAssertionError,
  expectNoDiagnostics,
  expectDiagnostic,
  expectRerunBudget,
  expectNoWaste,
  expectNoSilentHolds,
  expectHoldBudget
} from "./assertions.js";
export { assertBudget, assertBudgetFile, parseBudgetFile } from "./budgets.js";
export type { ScenarioBudget, BudgetFile } from "./budgets.js";
export type {
  NoDiagnosticsOptions,
  RerunBudgetOptions,
  WasteBudgetOptions,
  SilentHoldOptions,
  HoldBudgetOptions
} from "./assertions.js";
// The artifact's own shapes, and the runtimes' types it is built from, by
// their own names: the engine's from `@solidjs/signals/attribution`, the
// findings' from `@solidjs/signals`. The record tables (`ArtifactRecords`)
// are typed straight off the channel's catalogue — `BoundaryEvent` is
// `solid-js`'s, `InvocationEvent`/`CallEvent`/`FrameEvent` are
// `@solidjs/web`'s — so those are imported from their packages, not here.
export type {
  Attribution,
  AttributionOptions,
  AttributionCostTables,
  AttributionFeedbackTables,
  ArtifactAttribution,
  ArtifactRecords,
  ArtifactRecordType,
  ChangeOrigin,
  ChangeRecord,
  DiagnosticsArtifact,
  DiagnosticEvent,
  DiagnosticCode,
  DiagnosticSeverity,
  FallbackStats,
  FeedbackInteraction,
  FeedbackSource,
  FlightStats,
  HoldEvent,
  RerunEvent,
  ScopeCost,
  WriteCost
} from "./types.js";
