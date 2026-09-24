/**
 * Point queries over the engine's live state — the devtools/console view of
 * one scope. Their own module so a records-only consumer never ships them;
 * they read the engine's ring buffer and the graph, and register nothing.
 */
import { attribution, nodeIdOf, nodeName, type RerunEvent } from "./attribution.js";
import { $REFRESH } from "./constants.js";
import type { Computed } from "./types.js";

/** The node behind a memo/effect accessor, or the raw node passed through. */
function nodeOf(target: unknown): Computed<any> {
  return ((target as Record<symbol, unknown>)?.[$REFRESH] ?? target) as Computed<any>;
}

/**
 * Re-run history for one node — pass a memo/effect accessor or raw node.
 * Records name their scope by `nodeId`; a node that has never run under the
 * engine has none, and no history.
 */
export function why(target: unknown): RerunEvent[] {
  const id = nodeIdOf(nodeOf(target));
  if (id === undefined) return [];
  return attribution.history("rerun").filter(event => event.nodeId === id);
}

/** Current dependency names of one scope — the devtools subscription view. */
export function subscriptions(target: unknown): string[] {
  const node = nodeOf(target);
  const names: string[] = [];
  for (let l = node?._deps ?? null; l !== null; l = l._nextDep) names.push(nodeName(l._dep));
  return names;
}
