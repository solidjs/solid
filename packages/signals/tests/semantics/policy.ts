import type { Failure, Frame } from "./rules.js";

export const waitingPolicies = ["review", "required-only", "retain-disposed"] as const;
export type WaitingPolicy = (typeof waitingPolicies)[number];

/** Evidence from the scenario's declared readers, never Solid's blocker sets. */
export interface Observation {
  reader: number;
  write: number;
  at: string;
  disposedAt?: string;
}

export interface WaitingFinding {
  rule: "W1";
  message: string;
  policy: WaitingPolicy;
  disposition: "open" | "allowed" | "violation" | "out-of-scope";
  scope: "single-write-disposal" | "other";
  before: Frame;
  afterRetained: Frame;
  after: Frame;
  pending: string[];
  retained: Array<{ key: string; observations: Observation[] }>;
  releases: Array<{ key: string; retained: boolean; frame: Frame }>;
  recovered: boolean;
}

/** Permission applies only to a witnessed pending request, not its descendants. */
export function retainedObservations(observations: Observation[], write: number): Observation[] {
  return observations.filter(o => o.write === write && o.disposedAt !== undefined);
}

export function waitingSignature(finding: WaitingFinding): string {
  return [
    finding.rule,
    finding.policy,
    finding.disposition,
    finding.scope,
    finding.retained.length ? "observed-then-disposed" : "no-retained-witness",
    finding.recovered ? "recovered" : "unfinished",
    finding.releases.some(r => !r.retained) ? "other-work-released" : "retained-only"
  ].join(": ");
}

// Exceptions classify evidence after evaluating the ideal rule. They never
// disable a checker or waive final correctness. Default: no exceptions.
export const allowanceIds = ["legacy-disposal-wait"] as const;
export type Allowance = (typeof allowanceIds)[number];
export const allowanceContracts = {
  "legacy-disposal-wait": {
    rule: "P1",
    reference: "https://github.com/solidjs/solid/pull/3347#issuecomment-5626413374",
    scope:
      "one ordinary v1 write, unconditional readers, no boundaries; all remaining flights were observed then disposed for that write",
    reason:
      "Historical permission to finish after exact abandoned requests; optional compatibility, not the ideal contract"
  }
};
export interface ProgressFinding {
  failure: Failure;
  outstanding: Array<{ key: string; observations: Observation[] }>;
  allowance?: Allowance;
}
export function progressAllowance(
  enabled: readonly Allowance[],
  narrowDisposal: boolean,
  write: number,
  outstanding: ProgressFinding["outstanding"]
): Allowance | undefined {
  if (!narrowDisposal || !outstanding.length || !enabled.includes("legacy-disposal-wait")) return;
  for (const request of outstanding)
    if (!request.observations.some(o => o.write === write && o.disposedAt !== undefined)) return;
  return "legacy-disposal-wait";
}
