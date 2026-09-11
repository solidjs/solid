import type {
  ArtifactAttribution,
  ChangeOrigin,
  DiagnosticCode,
  DiagnosticsArtifact,
  HoldEvent,
  RerunRecord
} from "./types.js";

/**
 * Assertion failures carry the offending records so a test reporter (or an
 * agent reading the failure) sees the evidence, not just the verdict.
 */
export class DiagnosticsAssertionError extends Error {
  constructor(
    message: string,
    readonly evidence: unknown[]
  ) {
    const detail = evidence
      .slice(0, 10)
      .map(record => "  " + JSON.stringify(record))
      .join("\n");
    super(evidence.length > 0 ? `${message}\n${detail}` : message);
    this.name = "DiagnosticsAssertionError";
  }
}

export interface NoDiagnosticsOptions {
  /** Codes to tolerate (known/accepted warnings). */
  allow?: DiagnosticCode[];
}

/** The correctness gate: the capture produced no (unallowed) diagnostics. */
export function expectNoDiagnostics(
  artifact: DiagnosticsArtifact,
  options: NoDiagnosticsOptions = {}
): void {
  const allow = new Set(options.allow ?? []);
  const offending = artifact.diagnostics.filter(event => !allow.has(event.code));
  if (offending.length > 0) {
    throw new DiagnosticsAssertionError(
      `Expected no diagnostics but captured ${offending.length}:`,
      offending
    );
  }
}

/** Positive form: the scenario should trip a specific rule. */
export function expectDiagnostic(
  artifact: DiagnosticsArtifact,
  code: DiagnosticCode,
  options: { count?: number } = {}
): void {
  const matches = artifact.diagnostics.filter(event => event.code === code);
  if (matches.length === 0) {
    throw new DiagnosticsAssertionError(
      `Expected diagnostic ${code} but none was captured. Captured codes: [${artifact.diagnostics
        .map(event => event.code)
        .join(", ")}]`,
      []
    );
  }
  if (options.count !== undefined && matches.length !== options.count) {
    throw new DiagnosticsAssertionError(
      `Expected diagnostic ${code} exactly ${options.count} time(s) but captured ${matches.length}:`,
      matches
    );
  }
}

function requireAttributionData(
  artifact: DiagnosticsArtifact,
  caller: string
): ArtifactAttribution {
  if (!artifact.attribution) {
    throw new DiagnosticsAssertionError(
      `${caller} requires attribution data, but the artifact was captured with attribution disabled.`,
      []
    );
  }
  return artifact.attribution;
}

function requireAttribution(artifact: DiagnosticsArtifact, caller: string): RerunRecord[] {
  return requireAttributionData(artifact, caller).reruns;
}

export interface RerunBudgetOptions {
  /** Only count re-runs of scopes whose name matches. */
  scope?: string | RegExp;
}

/**
 * The efficiency gate: the scenario caused at most `max` re-runs. This is
 * the assertion that turns "the port works" into "the port is granular" —
 * an agent asserts the exact update cardinality instead of eyeballing it.
 */
export function expectRerunBudget(
  artifact: DiagnosticsArtifact,
  max: number,
  options: RerunBudgetOptions = {}
): void {
  let reruns = requireAttribution(artifact, "expectRerunBudget");
  if (options.scope !== undefined) {
    const scope = options.scope;
    reruns =
      typeof scope === "string"
        ? reruns.filter(rerun => rerun.nodeName === scope)
        : reruns.filter(rerun => scope.test(rerun.nodeName));
  }
  if (reruns.length > max) {
    throw new DiagnosticsAssertionError(
      `Expected at most ${max} re-run(s)${
        options.scope !== undefined ? ` for scope ${String(options.scope)}` : ""
      } but attribution recorded ${reruns.length}:`,
      reruns.map(rerun => ({
        run: rerun.run,
        nodeName: rerun.nodeName,
        nodeKind: rerun.nodeKind,
        changed: rerun.changed,
        causes: rerun.causes.map(cause => cause.name)
      }))
    );
  }
}

export interface WasteBudgetOptions {
  /** Tolerated wasted wall time in ms (default: unbounded — count gates). */
  maxWastedMs?: number;
  /** Tolerated count of wasted runs (default 0). */
  maxWastedRuns?: number;
}

/**
 * No-waste gate: no plain, non-held run recomputed to an unchanged value.
 * Overlay (optimistic/transition) and held runs are excluded by the same
 * rules attribution itself uses for `wastedMs`.
 */
export function expectNoWaste(
  artifact: DiagnosticsArtifact,
  options: WasteBudgetOptions = {}
): void {
  const reruns = requireAttribution(artifact, "expectNoWaste");
  const wasted = reruns.filter(rerun => !rerun.changed && rerun.phase === "plain" && !rerun.held);
  const wastedMs = wasted.reduce((total, rerun) => total + rerun.selfMs, 0);
  const maxRuns = options.maxWastedRuns ?? 0;
  const maxMs = options.maxWastedMs ?? Infinity;
  if (wasted.length > maxRuns || wastedMs > maxMs) {
    throw new DiagnosticsAssertionError(
      `Expected no wasted re-runs but attribution recorded ${wasted.length} ` +
        `(${wastedMs.toFixed(3)}ms of unchanged recomputes):`,
      wasted.map(rerun => ({
        run: rerun.run,
        nodeName: rerun.nodeName,
        nodeKind: rerun.nodeKind,
        selfMs: rerun.selfMs,
        causes: rerun.causes.map(cause => cause.name)
      }))
    );
  }
}

export interface SilentHoldOptions {
  /**
   * A silent hold shorter than this is tolerated (default 0: every silent
   * hold fails). The engine's `holds.infoMs`/`warnMs` (100/200ms) are the
   * console's numbers; this is the budget's.
   */
  maxSilentMs?: number;
}

/** No acknowledgment rendered and nothing painted while held — the SILENT_HOLD signature. */
function isSilent(hold: HoldEvent): boolean {
  return hold.acknowledgements.length === 0 && hold.paintedDuringHold === 0;
}

function describeInteraction(origin: ChangeOrigin | undefined): string | undefined {
  if (origin === undefined) return undefined;
  return `${origin.name} on ${origin.target ?? "an element"}`;
}

/** The shape a hold takes in assertion evidence: what was held, behind what, for how long, for whom. */
function holdEvidence(hold: HoldEvent) {
  return {
    holdMs: Math.round(hold.holdMs),
    tailMs: Math.round(hold.tailMs),
    interaction: describeInteraction(hold.interaction),
    heldWrites: hold.heldWrites.map(write => write.name),
    blockers: hold.blockers,
    acknowledgements: hold.acknowledgements,
    paintedDuringHold: hold.paintedDuringHold,
    action: hold.action
  };
}

/**
 * The responsiveness gate: every hold the scenario caused was
 * acknowledged on screen — an `isPending()`/`latest()` reader downstream of
 * the held write or its blocker, an optimistic value, an `affects()` mark, or
 * at least an effect that painted while it was held. A hold that had none of
 * those is time the user's input was dead. The repair is always to add the
 * feedback, never to remove the hold (see the reactivity-diagnostics skill,
 * SILENT_HOLD).
 */
export function expectNoSilentHolds(
  artifact: DiagnosticsArtifact,
  options: SilentHoldOptions = {}
): void {
  const { holds } = requireAttributionData(artifact, "expectNoSilentHolds");
  const maxMs = options.maxSilentMs ?? 0;
  const silent = holds.filter(hold => isSilent(hold) && hold.holdMs > maxMs);
  if (silent.length > 0) {
    const worst = Math.max(...silent.map(hold => hold.holdMs));
    throw new DiagnosticsAssertionError(
      `Expected no silent holds${maxMs > 0 ? ` over ${maxMs}ms` : ""} but attribution recorded ` +
        `${silent.length} (worst ${worst.toFixed(0)}ms) — a held write the screen never ` +
        `acknowledged. Read isPending() on the blocker, latest() on the held write, or write an ` +
        `optimistic value; do not move the write off the async path:`,
      silent.map(holdEvidence)
    );
  }
}

export interface HoldBudgetOptions {
  /** Only count holds whose blockers include this source (exact name or pattern). */
  source?: string | RegExp;
}

/**
 * The latency gate on holds: no hold — acknowledged or not — outlasted `maxMs`.
 * Acknowledgment makes a wait honest; it does not make it short. Use this for
 * the data path (a mocked source that should settle within the budget), and
 * `expectNoSilentHolds` for the feedback path.
 */
export function expectHoldBudget(
  artifact: DiagnosticsArtifact,
  maxMs: number,
  options: HoldBudgetOptions = {}
): void {
  let { holds } = requireAttributionData(artifact, "expectHoldBudget");
  if (options.source !== undefined) {
    const source = options.source;
    holds = holds.filter(hold =>
      hold.blockers.some(name => (typeof source === "string" ? name === source : source.test(name)))
    );
  }
  const over = holds.filter(hold => hold.holdMs > maxMs);
  if (over.length > 0) {
    throw new DiagnosticsAssertionError(
      `Expected every hold${
        options.source !== undefined ? ` on ${String(options.source)}` : ""
      } to settle within ${maxMs}ms but ${over.length} did not:`,
      over.map(holdEvidence)
    );
  }
}
