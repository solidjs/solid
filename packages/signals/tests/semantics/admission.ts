import type { RunResult } from "./runner.js";
import { waitingSignature } from "./policy.js";
import { rules } from "./rules.js";

const semanticRules = new Set<string>(rules.map(rule => rule.id));

/** Discovery may find a different bug, but not an invalid run or a waived wait. */
export function isSemanticFailure(result: RunResult): boolean {
  if (
    result.status !== "fail" ||
    !result.failure ||
    result.error ||
    result.cleanupError ||
    !semanticRules.has(result.failure.rule)
  )
    return false;
  if (result.failure.rule === "W1") return result.waiting?.disposition === "violation";
  if (result.failure.rule === "P1" && result.progress?.length)
    return result.progress.some(finding => !finding.allowance);
  return true;
}

export function fingerprint(result: RunResult): string | undefined {
  if (result.status === "error" && result.error) return `runtime: ${result.error.split("\n")[0]}`;
  if (result.status === "fail" && result.failure)
    return `${result.failure.rule}: ${result.failure.message}${
      result.failure.rule === "G2"
        ? `: ${(result.failure.expected as { relation?: string })?.relation}`
        : result.failure.rule === "W1" && result.waiting
          ? `: ${waitingSignature(result.waiting)}`
          : ""
    }`;
  const progress = result.progress?.[0];
  if ((result.status === "pass" || result.status === "policy") && progress)
    return `P1: ${progress.failure.message}: allowance=${progress.allowance ?? "none"}`;
  if ((result.status === "policy" || result.status === "pass") && result.waiting)
    return waitingSignature(result.waiting);
}
