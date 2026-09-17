/**
 * Point queries over the engine's live state — the devtools/console view of
 * one scope. Their own module so a records-only consumer never ships them;
 * they read the engine's ring buffer and the graph, and register nothing.
 */
import { attribution, nodeName, type RerunEvent } from "./attribution.js";
import { $REFRESH } from "./constants.js";
import { subjectOf } from "./dev.js";
import type { Computed } from "./types.js";

/** The node behind a memo/effect accessor, or the raw node passed through. */
function nodeOf(target: unknown): Computed<any> {
  return ((target as Record<symbol, unknown>)?.[$REFRESH] ?? target) as Computed<any>;
}

/** Re-run history for one node — pass a memo/effect accessor or raw node. */
export function why(target: unknown): RerunEvent[] {
  const node = nodeOf(target);
  return attribution.history().filter(event => subjectOf(event) === node);
}

/** Current dependency names of one scope — the devtools subscription view. */
export function subscriptions(target: unknown): string[] {
  const node = nodeOf(target);
  const names: string[] = [];
  for (let l = node?._deps ?? null; l !== null; l = l._nextDep) names.push(nodeName(l._dep));
  return names;
}
