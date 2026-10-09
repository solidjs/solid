import { queuedSteps, sourceIds, type Scenario } from "./scenario.js";
import { scenarioKey } from "./normalize.js";

/** A stable preference for less machinery, not shorter JSON or a bug identity. */
export function complexity(s: Scenario): number[] {
  let mechanisms = 0,
    operations = 0,
    expressions = 0;
  for (const n of s.nodes) {
    if (n.delivery !== "sync") mechanisms++;
    expressions += n.deps.length + (n.branch ? n.branch.otherwise.length + 1 : 0);
    if (n.factor !== 1) expressions++;
    if (n.offset !== 0) expressions++;
  }
  for (const r of s.readers) {
    expressions += r.refs.length;
    mechanisms += Number(r.gated) + Number(r.boundary !== "none") + Number(r.mounted !== undefined);
    mechanisms += Number(!!r.pending) + (r.pendingDepth ?? 0) + Number(!!r.render);
  }
  if (s.optimistic) mechanisms += 1 + s.optimistic.proposals.length;
  for (const a of s.actions ?? []) {
    mechanisms += a.segments.length;
    for (const segment of a.segments) operations += segment.length;
  }
  for (const t of s.turns) {
    mechanisms++;
    if ("steps" in t)
      for (const x of t.steps) {
        operations++;
        if (x.op === "queue") {
          mechanisms++;
          operations += queuedSteps(x).length;
        }
        if (x.op === "flush") mechanisms++;
      }
  }
  return [
    sourceIds(s).length + s.nodes.length + s.readers.length,
    mechanisms,
    operations,
    expressions
  ];
}

export function compareSize(a: Scenario, b: Scenario): number {
  const left = complexity(a),
    right = complexity(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function compareComplexity(a: Scenario, b: Scenario): number {
  const size = compareSize(a, b);
  if (size) return size;
  const x = scenarioKey(a),
    y = scenarioKey(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
