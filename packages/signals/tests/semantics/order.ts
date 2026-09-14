import { normalize, scenarioKey } from "./normalize.js";
import { queuedSteps, validate, type Leaf, type Scenario, type Step } from "./scenario.js";

function swap<T>(items: T[], i: number, j: number): T[] {
  const result = items.slice();
  result[i] = items[j];
  result[j] = items[i];
  return result;
}

/** Each move descends in the same ordering, so sorting cannot oscillate.
 * Even independent declarations may change notification order: these are
 * replay-tested candidates, never assumed equivalences. */
export function* orderingReductions(s: Scenario): Generator<Scenario> {
  const key = scenarioKey(s);
  function* offer(candidate: Scenario): Generator<Scenario> {
    if (validate(candidate)) return;
    const named = normalize(candidate);
    if (JSON.stringify(named) < key) yield named;
  }
  for (let i = 0; i < s.nodes.length; i++) {
    for (let j = i + 1; j < s.nodes.length; j++) yield* offer({ ...s, nodes: swap(s.nodes, i, j) });
    const n = s.nodes[i];
    for (let j = 1; j < n.deps.length; j++) {
      const nodes = s.nodes.slice();
      nodes[i] = { ...n, deps: swap(n.deps, j - 1, j) };
      yield* offer({ ...s, nodes });
    }
  }
  for (let i = 0; i < s.readers.length; i++) {
    for (let j = i + 1; j < s.readers.length; j++)
      yield* offer({ ...s, readers: swap(s.readers, i, j) });
    const r = s.readers[i];
    for (let j = 1; j < r.refs.length; j++) {
      const readers = s.readers.slice();
      readers[i] = { ...r, refs: swap(r.refs, j - 1, j) };
      yield* offer({ ...s, readers });
    }
  }
  // Do not move anything across a host turn, callback, or explicit flush.
  // Reordering different setters is still tested: changing mount/visibility
  // order can change observation even when both setters run in one callback.
  function movable(a: Leaf | Step, b: Leaf | Step): boolean {
    // Progress can change observation even within one callback. Keep start/resume
    // order intact; these are replay-tested swaps with setters, not commutativity.
    if (a.op === "resume-action") return b.op === "show" || b.op === "mount" || b.op === "write";
    if (b.op === "resume-action") return a.op === "show" || a.op === "mount" || a.op === "write";
    if (a.op !== "write" && a.op !== "show" && a.op !== "mount") return false;
    if (b.op !== "write" && b.op !== "show" && b.op !== "mount") return false;
    if (a.op !== b.op) return true;
    if (a.op === "write" && b.op === "write") return (a.source ?? -1) !== (b.source ?? -1);
    return a.op === "mount" && b.op === "mount" && a.reader !== b.reader;
  }
  for (let i = 0; i < s.turns.length; i++) {
    const turn = s.turns[i];
    if (!("steps" in turn)) continue;
    for (let j = 0; j < turn.steps.length; j++) {
      if (j && movable(turn.steps[j - 1], turn.steps[j])) {
        const turns = s.turns.slice();
        turns[i] = { steps: swap(turn.steps, j - 1, j) };
        yield* offer({ ...s, turns });
      }
      const q = turn.steps[j];
      if (q.op !== "queue") continue;
      const payload = queuedSteps(q);
      for (let k = 1; k < payload.length; k++) {
        if (!movable(payload[k - 1], payload[k])) continue;
        const steps = turn.steps.slice();
        steps[j] = { op: "queue", id: q.id, via: q.via, steps: swap(payload, k - 1, k) };
        const turns = s.turns.slice();
        turns[i] = { steps };
        yield* offer({ ...s, turns });
      }
    }
  }
}

/** Keep a delivery/order pivot from undoing earlier ordering progress after
 * another family simplifies delivery. A smaller graph starts a new search. */
export class OrderingLimit {
  private size: number;
  private key: string;

  constructor(s: Scenario) {
    this.size = s.nodes.length;
    this.key = scenarioKey(s);
  }

  allows(s: Scenario): boolean {
    return (
      s.nodes.length < this.size || (s.nodes.length === this.size && scenarioKey(s) < this.key)
    );
  }

  accept(s: Scenario): void {
    if (s.nodes.length > this.size) return;
    const key = scenarioKey(s);
    if (s.nodes.length < this.size || key < this.key) {
      this.size = s.nodes.length;
      this.key = key;
    }
  }
}
