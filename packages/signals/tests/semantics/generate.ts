import * as fc from "fast-check";
import {
  queuedSteps,
  type Delivery,
  type Leaf,
  type MemoSpec,
  type ReaderSpec,
  type Scenario,
  type Turn
} from "./scenario.js";

// Small bounded graphs are cheap enough to explore thousands of schedules.
// References are constructed topologically, never repaired after generation.
export const scenarioArbitrary: fc.Arbitrary<Scenario> = fc
  .integer({ min: 1, max: 5 })
  .chain(size => {
    const nodes = Array.from({ length: size }, (_, id) =>
      fc.record({
        id: fc.constant(id),
        deps: fc.uniqueArray(fc.integer({ min: -1, max: id - 1 }), {
          minLength: 1,
          maxLength: Math.min(2, id + 1)
        }),
        factor: fc.integer({ min: 1, max: 2 }),
        offset: fc.integer({ min: 0, max: 2 }),
        delivery: fc.constantFrom<Delivery>("sync", "sync", "manual", "await", "promise")
      })
    );
    const reader = fc.record({
      refs: fc.uniqueArray(fc.integer({ min: -1, max: size - 1 }), { minLength: 1, maxLength: 3 }),
      gated: fc.boolean()
    });
    const leaf: fc.Arbitrary<Leaf> = fc.oneof(
      {
        weight: 5,
        arbitrary: fc.integer({ min: 0, max: 3 }).map(value => ({ op: "write" as const, value }))
      },
      {
        weight: 3,
        arbitrary: fc.record({
          op: fc.constant("resolve" as const),
          node: fc.integer({ min: 0, max: size - 1 }),
          which: fc.constantFrom("oldest" as const, "newest" as const)
        })
      },
      { weight: 2, arbitrary: fc.boolean().map(value => ({ op: "show" as const, value })) },
      { weight: 1, arbitrary: fc.constant({ op: "flush" as const }) }
    );
    return fc
      .record({
        nodes: fc.tuple(...nodes),
        readers: fc.array(reader, { minLength: 1, maxLength: 3 }),
        boundary: fc.constantFrom(
          "none" as const,
          "none" as const,
          "retain" as const,
          "reset" as const
        ),
        show: fc.boolean(),
        blocks: fc.array(
          fc.record({
            first: leaf,
            second: leaf,
            kind: fc.integer({ min: 0, max: 8 }),
            queueFirst: fc.boolean()
          }),
          { minLength: 3, maxLength: 10 }
        ),
        dispose: fc.boolean()
      })
      .map(spec => {
        const turns: Turn[] = [];
        let id = 0;
        for (const b of spec.blocks) {
          if (b.kind < 3) turns.push({ steps: b.kind === 0 ? [b.first, b.second] : [b.first] });
          else {
            const via = (["microtask", "promise", "await", "task", "task", "task"] as const)[
              b.kind - 3
            ];
            const callback = id++;
            const queue = { op: "queue" as const, id: callback, via, step: b.second };
            turns.push({ steps: b.queueFirst ? [queue, b.first] : [b.first, queue] });
            if (b.kind === 7) turns.push({ steps: [{ op: "cancel", id: callback }] });
            else if (b.kind === 6) turns.push({ task: callback });
          }
        }
        if (spec.dispose) turns.push({ steps: [{ op: "dispose", reader: 0 }] });
        return {
          version: 1,
          show: spec.show,
          nodes: spec.nodes as MemoSpec[],
          readers: spec.readers.map(
            (r, id): ReaderSpec => ({ ...r, id, boundary: id === 0 ? spec.boundary : "none" })
          ),
          turns
        };
      });
  });

export const multiSourceArbitrary: fc.Arbitrary<Scenario> = scenarioArbitrary.chain(base =>
  fc
    .record({
      nodes: fc.array(fc.integer({ min: 0, max: 3 }), {
        minLength: base.nodes.length,
        maxLength: base.nodes.length
      }),
      readers: fc.array(fc.boolean(), {
        minLength: base.readers.length,
        maxLength: base.readers.length
      }),
      assignments: fc.integer({ min: 0, max: 0x7fffffff }),
      continuationBlock: fc.boolean()
    })
    .map(options => {
      const s = structuredClone(base);
      s.version = 2;
      s.sources = [-1, -2];
      s.nodes.forEach((node, i) => {
        if (options.nodes[i] & 1) node.deps = node.deps.map(id => (id === -1 ? -2 : id));
        if (options.nodes[i] & 2) node.deps = [...new Set([...node.deps, -2])];
      });
      s.readers.forEach((reader, i) => {
        if (options.readers[i]) reader.refs = [...new Set([...reader.refs, -2])];
      });
      let next = 0;
      const assign = (step: Leaf) => {
        if (step.op === "write") step.source = options.assignments & (1 << next++) ? -1 : -2;
      };
      for (const turn of s.turns) {
        if (!("steps" in turn)) continue;
        for (const step of turn.steps) {
          if (step.op === "queue") {
            queuedSteps(step).forEach(assign);
            if (options.continuationBlock && step.step?.op === "write") {
              const first = step.step;
              delete step.step;
              step.steps = [first, { ...first, source: first.source === -1 ? -2 : -1 }];
            }
          } else if (step.op !== "cancel") assign(step);
        }
      }
      return s;
    })
);

export const optimisticArbitrary: fc.Arbitrary<Scenario> = scenarioArbitrary.chain(base =>
  fc
    .record({
      proposals: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 3 }),
      authoritative: fc.integer({ min: 0, max: 3 })
    })
    .map(optimistic => {
      const s = structuredClone(base);
      s.version = 2;
      s.sources = [-1, -2];
      s.optimistic = optimistic;
      s.show = true;
      s.nodes.forEach(n => {
        n.deps = n.deps.map(id => (id === -1 ? -2 : id));
      });
      s.readers.forEach(r => {
        r.refs = r.refs.map(id => (id === -1 ? -2 : id));
        r.gated = false;
        r.boundary = "none";
      });
      const convert = (step: Leaf): Leaf =>
        step.op === "write"
          ? { op: "resume-action" }
          : step.op === "show" || step.op === "dispose" || step.op === "flush"
            ? { op: "noop" }
            : step;
      for (const turn of s.turns)
        if ("steps" in turn)
          turn.steps = turn.steps.map(step =>
            step.op === "queue"
              ? { op: "queue", id: step.id, via: step.via, steps: queuedSteps(step).map(convert) }
              : step.op === "cancel"
                ? step
                : convert(step)
          );
      s.turns.unshift({ steps: [{ op: "start-action" }] });
      return s;
    })
);

export const readsArbitrary: fc.Arbitrary<Scenario> = scenarioArbitrary.chain(base =>
  fc
    .record({
      refs: fc.array(fc.integer({ min: -1, max: base.nodes.length - 1 }), {
        minLength: base.turns.length,
        maxLength: base.turns.length
      }),
      modes: fc.array(fc.boolean(), { minLength: base.turns.length, maxLength: base.turns.length })
    })
    .map(options => {
      const s = structuredClone(base);
      s.turns.forEach((turn, i) => {
        if ("steps" in turn) {
          const read: Leaf = {
            op: "read",
            ref: options.refs[i],
            mode: options.modes[i] ? "plain" : "latest"
          };
          turn.steps.unshift(read);
          turn.steps.push({ ...read });
        }
      });
      s.turns.push({ steps: [{ op: "read", ref: -1, mode: "latest" }] });
      return s;
    })
);

export const mountsArbitrary: fc.Arbitrary<Scenario> = scenarioArbitrary.map(base => {
  const s = structuredClone(base);
  s.version = 2;
  s.sources = [-1];
  s.readers[0].mounted = s.show;
  s.readers[0].gated = false;
  const convert = (step: Leaf): Leaf =>
    step.op === "show"
      ? { op: "mount", reader: 0, value: step.value }
      : step.op === "dispose"
        ? { op: "mount", reader: 0, value: false }
        : step;
  for (const turn of s.turns)
    if ("steps" in turn)
      turn.steps = turn.steps.map(step =>
        step.op === "queue"
          ? { op: "queue", id: step.id, via: step.via, steps: queuedSteps(step).map(convert) }
          : step.op === "cancel"
            ? step
            : convert(step)
      );
  return s;
});

export const latestArbitrary: fc.Arbitrary<Scenario> = mountsArbitrary.chain(base =>
  fc
    .record({
      proposals: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 3 }),
      authoritative: fc.integer({ min: 0, max: 3 }),
      anchors: fc.subarray([-1, -2]),
      viaMemo: fc.boolean(),
      anchorShow: fc.boolean()
    })
    .map(({ anchors, anchorShow, ...action }) => {
      const s = structuredClone(base);
      s.sources = [-1, -2];
      s.anchors = anchors;
      s.anchorShow = anchorShow;
      s.optimistic = { ...action, kind: "latest" };
      s.nodes.forEach(n => (n.deps = n.deps.map(id => (id === -1 ? -2 : id))));
      s.readers.forEach(r => (r.refs = r.refs.map(id => (id === -1 ? -2 : id))));
      const convert = (step: Leaf): Leaf => (step.op === "write" ? { op: "resume-action" } : step);
      for (const turn of s.turns)
        if ("steps" in turn)
          turn.steps = turn.steps.map(step =>
            step.op === "queue"
              ? { op: "queue", id: step.id, via: step.via, steps: queuedSteps(step).map(convert) }
              : step.op === "cancel"
                ? step
                : convert(step)
          );
      s.turns.unshift({ steps: [{ op: "start-action" }] });
      return s;
    })
);

export const observationArbitrary: fc.Arbitrary<Scenario> = mountsArbitrary.chain(base =>
  fc
    .record({ anchored: fc.boolean(), anchorShow: fc.boolean() })
    .map(({ anchored, anchorShow }) => ({
      ...base,
      anchors: anchored ? [-1] : [],
      anchorShow
    }))
);

export const branchesArbitrary: fc.Arbitrary<Scenario> = multiSourceArbitrary.chain(base =>
  fc
    .record({
      choices: fc.array(fc.boolean(), {
        minLength: base.nodes.length,
        maxLength: base.nodes.length
      }),
      anchored: fc.boolean()
    })
    .map(({ choices, anchored }) => {
      const s = structuredClone(base);
      s.anchors = anchored ? [-1, -2] : [];
      s.readers.forEach(r => (r.boundary = "none"));
      s.nodes.forEach((n, i) => {
        if (choices[i]) n.branch = { condition: -2, otherwise: [i === 0 ? -1 : i - 1] };
      });
      return s;
    })
);

// Independent boundary regions can share data but never share fallback permission.
export const boundariesArbitrary: fc.Arbitrary<Scenario> = multiSourceArbitrary.chain(base =>
  fc
    .array(fc.constantFrom("none" as const, "retain" as const, "reset" as const), {
      minLength: base.readers.length,
      maxLength: base.readers.length
    })
    .map(boundaries => ({
      ...base,
      readers: base.readers.map((reader, i) => ({ ...reader, boundary: boundaries[i] }))
    }))
);

export const nestedArbitrary: fc.Arbitrary<Scenario> = boundariesArbitrary.map(base => {
  const s = structuredClone(base);
  if (s.readers.length === 1)
    s.readers.push({ ...s.readers[0], refs: [s.nodes.at(-1)!.id], id: 1 });
  for (let i = 0; i < s.readers.length; i++) {
    const reader = s.readers[i];
    reader.gated = false;
    if (i === 0 && reader.boundary === "none") reader.boundary = "retain";
    if (i > 0) reader.parent = i > 1 && s.readers[i - 1].boundary !== "none" ? i - 1 : 0;
  }
  for (const turn of s.turns)
    if ("steps" in turn)
      for (let i = 0; i < turn.steps.length; i++) {
        const step = turn.steps[i];
        if (step.op === "dispose") turn.steps[i] = { op: "noop" };
        else if (step.op === "queue") {
          const leaves = queuedSteps(step);
          for (let j = 0; j < leaves.length; j++)
            if (leaves[j].op === "dispose") leaves[j] = { op: "noop" };
          delete step.step;
          step.steps = leaves;
        }
      }
  return s;
});

export const branchBoundariesArbitrary: fc.Arbitrary<Scenario> = branchesArbitrary.chain(base =>
  fc.constantFrom("retain" as const, "reset" as const).map(boundary => {
    const s = structuredClone(base);
    // Ensure this cohort exercises history rather than occasionally becoming
    // an ordinary boundary scenario with no branch at all.
    if (!s.nodes.some(n => n.branch)) s.nodes[0].branch = { condition: -2, otherwise: [-1] };
    s.readers[0].boundary = boundary;
    return s;
  })
);

export const readinessArbitrary: fc.Arbitrary<Scenario> = fc
  .oneof(
    observationArbitrary,
    observationArbitrary.map(base => ({
      ...base,
      anchors: [-1],
      readers: base.readers.map(reader => ({
        ...reader,
        gated: false,
        boundary: "none" as const,
        mounted: undefined
      })),
      turns: base.turns.map(turn =>
        "steps" in turn
          ? {
              steps: turn.steps.map(step =>
                step.op === "queue"
                  ? {
                      op: "queue" as const,
                      id: step.id,
                      via: step.via,
                      steps: queuedSteps(step).map(leaf =>
                        leaf.op === "mount" ? { op: "noop" as const } : leaf
                      )
                    }
                  : step.op === "mount"
                    ? { op: "noop" as const }
                    : step
              )
            }
          : turn
      )
    }))
  )
  .map(base => {
    const s = structuredClone(base);
    s.readers[0].pending = true;
    const ref = s.readers[0].refs[0];
    s.turns = s.turns.flatMap(turn => [
      turn,
      {
        steps: [
          { op: "click" as const, reader: 0 },
          { op: "read" as const, ref, mode: "pending" as const }
        ]
      }
    ]);
    return s;
  });

export const derivedReadinessArbitrary: fc.Arbitrary<Scenario> = readinessArbitrary.chain(base =>
  fc.integer({ min: 1, max: 3 }).map(pendingDepth => {
    const s = structuredClone(base);
    s.readers[0].pendingDepth = pendingDepth;
    return s;
  })
);

export const optimisticReadinessArbitrary: fc.Arbitrary<Scenario> = optimisticArbitrary.chain(
  base =>
    fc.integer({ min: 0, max: 3 }).map(depth => {
      const s = structuredClone(base);
      s.readers[0].pending = true;
      if (depth) s.readers[0].pendingDepth = depth;
      s.turns = s.turns.flatMap(turn => [turn, { steps: [{ op: "click" as const, reader: 0 }] }]);
      return s;
    })
);

/** Focused update schedules over varied DAGs, with foreign requests/actions
 * deliberately left open. No generator-provided grouping is trusted by the oracle. */
export const updateGroupsArbitrary: fc.Arbitrary<Scenario> = multiSourceArbitrary.chain(base =>
  fc
    .record({
      mode: fc.integer({ min: 0, max: 4 }),
      actions: fc.boolean(),
      secondSegment: fc.boolean(),
      mixed: fc.boolean(),
      reverse: fc.boolean()
    })
    .map(options => {
      const nodes = base.nodes;
      const readers: ReaderSpec[] = [];
      for (const node of nodes)
        readers.push({ id: readers.length, refs: [node.id], gated: false, boundary: "none" });
      readers.push({
        id: readers.length,
        refs: options.mixed ? [-1, -2, nodes[nodes.length - 1].id] : [-1, -2],
        gated: false,
        boundary: "none"
      });
      const s: Scenario = { version: 2, sources: [-1, -2], show: true, nodes, readers, turns: [] };
      const first: Leaf = options.actions
        ? { op: "start-action", action: 0 }
        : { op: "write", source: -1, value: 1 };
      const second: Leaf = options.actions
        ? { op: "start-action", action: 1 }
        : { op: "write", source: -2, value: 1 };
      if (options.actions)
        s.actions = [
          {
            id: 0,
            segments: [
              [{ source: -1, value: 1 }],
              ...(options.secondSegment ? [[{ source: -1, value: 2 }]] : []),
              []
            ]
          },
          { id: 1, segments: [[{ source: -2, value: 1 }], []] }
        ];
      if (options.mode === 0) s.turns.push({ steps: [first, second] });
      else if (options.mode === 1) s.turns.push({ steps: [first, { op: "flush" }, second] });
      else if (options.mode === 2) s.turns.push({ steps: [first] }, { steps: [second] });
      else {
        const queued = { op: "queue" as const, id: 0, via: "microtask" as const, step: second };
        s.turns.push({ steps: options.mode === 3 ? [queued, first] : [first, queued] });
      }
      if (options.actions && options.secondSegment)
        s.turns.push({ steps: [{ op: "resume-action", action: 0 }] });
      // Resolve nodes one at a time. Chains may spawn later occurrences, which
      // the existing completion suffix handles after the measured prefix.
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[options.reverse ? nodes.length - i - 1 : i];
        if (n.delivery === "manual" || n.delivery === "await")
          s.turns.push({ steps: [{ op: "resolve", node: n.id, which: "newest" }] });
      }
      if (options.actions)
        s.turns.push({ steps: [{ op: "resume-action", action: options.reverse ? 1 : 0 }] });
      return s;
    })
);

export const attachmentArbitrary: fc.Arbitrary<Scenario> = fc
  .integer({ min: 2, max: 4 })
  .chain(size =>
    fc
      .record({
        deliveries: fc.array(fc.constantFrom<Delivery>("sync", "promise", "manual", "await"), {
          minLength: size,
          maxLength: size
        }),
        factors: fc.array(fc.integer({ min: 1, max: 2 }), { minLength: size, maxLength: size }),
        offsets: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: size, maxLength: size }),
        on: fc.integer({ min: -1, max: size - 2 }),
        portal: fc.boolean(),
        scheduled: fc.boolean(),
        writes: fc.integer({ min: 1, max: 3 }),
        reverse: fc.boolean(),
        dispose: fc.boolean()
      })
      .map(spec => {
        const nodes: MemoSpec[] = [];
        for (let id = 0; id < size; id++)
          nodes.push({
            id,
            deps: [id - 1],
            factor: spec.factors[id],
            offset: spec.offsets[id],
            delivery: spec.deliveries[id]
          });
        const turns: Turn[] = [];
        for (let value = 1; value <= spec.writes; value++) {
          turns.push({ steps: [{ op: "write", value }] });
          for (let i = 0; i < size; i++)
            turns.push({
              steps: [{ op: "resolve", node: spec.reverse ? size - 1 - i : i, which: "newest" }]
            });
        }
        if (spec.dispose) turns.push({ steps: [{ op: "dispose", reader: 0 }] });
        return {
          version: 2,
          sources: [-1],
          show: true,
          nodes,
          readers: [
            {
              id: 0,
              refs: [size - 1],
              gated: false,
              boundary: "none",
              render: {
                on: spec.on,
                target: spec.portal ? "portal" : "local",
                scheduled: spec.portal || spec.scheduled
              }
            }
          ],
          turns
        };
      })
  );

export type Cohort =
  | "attachment"
  | "update-groups"
  | "branch-boundaries"
  | "optimistic-readiness"
  | "derived-readiness"
  | "nested"
  | "boundaries"
  | "readiness"
  | "ordinary"
  | "multi"
  | "optimistic"
  | "reads"
  | "mounts"
  | "latest"
  | "observation"
  | "branches";
export function generate(seed: number, count: number, cohort: Cohort = "ordinary"): Scenario[] {
  const arbitrary =
    cohort === "attachment"
      ? attachmentArbitrary
      : cohort === "update-groups"
        ? updateGroupsArbitrary
        : cohort === "branch-boundaries"
          ? branchBoundariesArbitrary
          : cohort === "optimistic-readiness"
            ? optimisticReadinessArbitrary
            : cohort === "derived-readiness"
              ? derivedReadinessArbitrary
              : cohort === "nested"
                ? nestedArbitrary
                : cohort === "boundaries"
                  ? boundariesArbitrary
                  : cohort === "readiness"
                    ? readinessArbitrary
                    : cohort === "branches"
                      ? branchesArbitrary
                      : cohort === "latest"
                        ? latestArbitrary
                        : cohort === "observation"
                          ? observationArbitrary
                          : cohort === "mounts"
                            ? mountsArbitrary
                            : cohort === "reads"
                              ? readsArbitrary
                              : cohort === "optimistic"
                                ? optimisticArbitrary
                                : cohort === "multi"
                                  ? multiSourceArbitrary
                                  : scenarioArbitrary;
  return fc.sample(arbitrary, { seed, numRuns: count });
}
