import { anchorIds, dependencies, queuedSteps, validate, type Scenario } from "./scenario.js";
import {
  canonicalize,
  structuralReductions,
  focusedReductions,
  pruningReductions,
  arithmeticReductions,
  edgeReductions,
  observationReductions,
  lifecycleReductions,
  scheduleReductions,
  coneReductions,
  branchReductions,
  deliveryScheduleReductions,
  observationCollapseReductions,
  mergeArithmeticReductions,
  deliveryOrderingReductions,
  callbackEndReductions,
  initialVisibilityReductions,
  cutReductions,
  deliveryEscapeReductions
} from "./reduce.js";
import { normalize, scenarioKey } from "./normalize.js";
import { orderingReductions } from "./order.js";

/** Structural edits retain exact questions. Identity-value renaming and bounded
 * affine folding translate inputs explicitly, retaining owner and occurrence. */
export const reductionFamilies = {
  normalize: normalizeCandidates,
  anchors: anchorsCandidates,
  optimistic: optimisticCandidates,
  actions: actionsCandidates,
  sources: sourcesCandidates,
  turns: turnsCandidates,
  focused: focusedCandidates,
  arithmetic: arithmeticReductions,
  pruning: pruningReductions,
  structural: structuralCandidates,
  edges: edgeReductions,
  observation: observationReductions,
  lifecycle: lifecycleReductions,
  schedule: scheduleReductions,
  cones: coneReductions,
  branches: branchReductions,
  deliverySchedule: deliveryScheduleReductions,
  observationCollapse: observationCollapseReductions,
  mergeArithmetic: mergeArithmeticReductions,
  deliveryOrdering: deliveryOrderingReductions,
  callbackEnd: callbackEndReductions,
  initialVisibility: initialVisibilityReductions,
  cuts: cutReductions,
  deliveryEscape: deliveryEscapeReductions,
  steps: stepsCandidates,
  readers: readersCandidates,
  nodes: nodesCandidates,
  ordering: orderingCandidates
};

export type ReductionFamily = keyof typeof reductionFamilies;
// Prune disconnected work before replaying detailed edits on a larger graph.
// Single-use edge trials finish cases well but compete with cheaper edits in
// short searches. Keep them last; higher acceptance alone is not a priority rule.
export const reductionOrder: readonly ReductionFamily[] = [
  "normalize",
  "pruning",
  "anchors",
  "optimistic",
  "actions",
  "sources",
  "turns",
  "focused",
  "arithmetic",
  "structural",
  "steps",
  "readers",
  "nodes",
  "ordering",
  "edges",
  "observation",
  "lifecycle",
  "cones",
  "schedule",
  "branches",
  "deliverySchedule",
  "observationCollapse",
  "initialVisibility",
  "callbackEnd",
  "mergeArithmetic",
  "deliveryOrdering",
  "cuts",
  "deliveryEscape"
];

export function* reductions(
  s: Scenario,
  order: readonly ReductionFamily[] = reductionOrder,
  enter?: (family: ReductionFamily) => void
): Generator<Scenario> {
  for (const family of order) {
    enter?.(family);
    yield* reductionFamilies[family](s);
  }
}

function* normalizeCandidates(s: Scenario): Generator<Scenario> {
  const named = normalize(s);
  if (JSON.stringify(named) !== JSON.stringify(s)) yield named;
}

function* anchorsCandidates(s: Scenario): Generator<Scenario> {
  if (s.version === 2) {
    const observed = anchorIds(s);
    for (let i = 0; i < observed.length; i++) {
      const anchors = observed.slice();
      anchors.splice(i, 1);
      yield { ...s, anchors };
    }
    if (s.anchorShow !== false) yield { ...s, anchorShow: false };
  }
}

function* optimisticCandidates(s: Scenario): Generator<Scenario> {
  if (s.optimistic) {
    for (let i = 0; i < s.optimistic.proposals.length; i++) {
      if (s.optimistic.proposals.length > 1) {
        const c = structuredClone(s);
        c.optimistic!.proposals.splice(i, 1);
        yield c;
      }
      if (s.optimistic.proposals[i] !== 0) {
        const c = structuredClone(s);
        c.optimistic!.proposals[i] = 0;
        yield c;
      }
    }
    if (s.optimistic.authoritative !== 0) {
      const c = structuredClone(s);
      c.optimistic!.authoritative = 0;
      yield c;
    }
  }
}

function* actionsCandidates(s: Scenario): Generator<Scenario> {
  if (s.actions) {
    for (let i = 0; i < s.actions.length; i++) {
      const script = s.actions[i];
      for (let j = 0; j < script.segments.length; j++) {
        for (let k = 0; k < script.segments[j].length; k++) {
          const c = structuredClone(s);
          c.actions![i].segments[j].splice(k, 1);
          yield c;
        }
        if (script.segments.length > 2) {
          const c = structuredClone(s);
          c.actions![i].segments.splice(j, 1);
          yield c;
        }
      }
    }
  }
}

function* sourcesCandidates(s: Scenario): Generator<Scenario> {
  if (s.version === 2) {
    const used = new Set([
      ...s.nodes.flatMap(n => dependencies(n)),
      ...s.readers.flatMap(r => r.refs),
      -1
    ]);
    for (const turn of s.turns)
      if ("steps" in turn)
        for (const step of turn.steps) {
          const leaves = step.op === "queue" ? queuedSteps(step) : [step];
          for (const leaf of leaves) if (leaf.op === "write") used.add(leaf.source ?? -1);
        }
    for (const a of s.actions ?? [])
      for (const segment of a.segments) for (const w of segment) used.add(w.source);
    for (const source of s.sources!)
      if (!used.has(source)) {
        const c = structuredClone(s);
        c.sources = c.sources!.filter(id => id !== source);
        yield c;
      }
  }
}

function* turnsCandidates(s: Scenario): Generator<Scenario> {
  for (
    let width = Math.max(1, Math.ceil(s.turns.length / 2));
    width >= 1;
    width = Math.floor(width / 2)
  ) {
    for (let i = 0; i < s.turns.length; i += width) {
      const c = structuredClone(s);
      c.turns.splice(i, width);
      yield c;
    }
  }
  // Removing a turn also removes its work. Joining two event bodies tests
  // whether only their intervening scheduler drain was unnecessary. This is
  // a batching change, never a normalization or an equivalence assertion.
  for (let i = 1; i < s.turns.length; i++) {
    const a = s.turns[i - 1],
      b = s.turns[i];
    if (!("steps" in a) || !("steps" in b)) continue;
    const turns = s.turns.slice();
    turns.splice(i - 1, 2, { steps: a.steps.concat(b.steps) });
    yield { ...s, turns };
  }
}

function* focusedCandidates(s: Scenario): Generator<Scenario> {
  yield* focusedReductions(s);
}

function* structuralCandidates(s: Scenario): Generator<Scenario> {
  yield* structuralReductions(s, false);
}

function* stepsCandidates(s: Scenario): Generator<Scenario> {
  for (let i = 0; i < s.turns.length; i++) {
    const turn = s.turns[i];
    if (!("steps" in turn)) continue;
    for (let j = 0; j < turn.steps.length; j++) {
      const c = structuredClone(s);
      const t = c.turns[i];
      if ("steps" in t) t.steps.splice(j, 1);
      yield c;
      const step = turn.steps[j];
      if (step.op === "queue" && step.steps)
        for (let k = 0; k < step.steps.length; k++) {
          const c = structuredClone(s);
          const t = c.turns[i];
          if ("steps" in t) {
            const q = t.steps[j];
            if (q.op === "queue") queuedSteps(q).splice(k, 1);
          }
          yield c;
        }
    }
  }
}

function* readersCandidates(s: Scenario): Generator<Scenario> {
  for (let i = 0; i < s.readers.length; i++) {
    const c = structuredClone(s);
    c.readers.splice(i, 1);
    yield c;
    if (s.readers[i].render) {
      const c = structuredClone(s);
      delete c.readers[i].render;
      yield c;
      if (s.readers[i].render!.on !== -1) {
        const c = structuredClone(s);
        c.readers[i].render!.on = -1;
        yield c;
      }
    }
    if (s.readers[i].parent !== undefined) {
      const c = structuredClone(s);
      delete c.readers[i].parent;
      yield c;
    }
    if (s.readers[i].pendingDepth) {
      const c = structuredClone(s);
      if (c.readers[i].pendingDepth === 1) delete c.readers[i].pendingDepth;
      else c.readers[i].pendingDepth!--;
      yield c;
    }
    if (s.readers[i].pending) {
      const c = structuredClone(s);
      delete c.readers[i].pending;
      delete c.readers[i].pendingDepth;
      // Remove only operations attached to this feature; keep other event work.
      const remove = (x: { op: string; reader?: number }) =>
        x.op !== "click" || x.reader !== s.readers[i].id;
      for (const turn of c.turns)
        if ("steps" in turn) {
          turn.steps = turn.steps.filter(remove);
          for (const step of turn.steps)
            if (step.op === "queue") {
              const steps = queuedSteps(step).filter(remove);
              delete step.step;
              step.steps = steps;
            }
        }
      yield c;
    }
    if (s.readers[i].boundary !== "none") {
      const c = structuredClone(s);
      c.readers[i].boundary = "none";
      yield c;
    }
  }
}

function* nodesCandidates(s: Scenario): Generator<Scenario> {
  for (const node of s.nodes) {
    if (node.branch)
      for (const deps of [node.deps, node.branch.otherwise]) {
        const c = structuredClone(s);
        const n = c.nodes.find(n => n.id === node.id)!;
        n.deps = [...deps];
        delete n.branch;
        yield c;
      }
    if (
      !s.nodes.some(n => dependencies(n).includes(node.id)) &&
      !s.readers.some(r => r.refs.includes(node.id) || r.render?.on === node.id)
    ) {
      const c = structuredClone(s);
      c.nodes = c.nodes.filter(n => n.id !== node.id);
      yield c;
    }
    for (const field of ["factor", "offset"] as const) {
      const value = field === "factor" ? 1 : 0;
      if (node[field] === value) continue;
      const c = structuredClone(s);
      c.nodes.find(n => n.id === node.id)![field] = value;
      yield c;
    }
  }
}

function* orderingCandidates(s: Scenario): Generator<Scenario> {
  yield* orderingReductions(s);
}

export const expensiveFamilies = new Set<ReductionFamily>([
  "mergeArithmetic",
  "deliveryOrdering",
  "cuts",
  "deliveryEscape"
]);
