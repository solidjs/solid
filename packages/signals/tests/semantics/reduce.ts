import {
  anchorIds,
  sourceIds,
  validate,
  dependencies,
  queuedSteps,
  type Leaf,
  type MemoSpec,
  type ReaderSpec,
  type Turn,
  type Scenario,
  type Step
} from "./scenario.js";

import { normalize, scenarioKey } from "./normalize.js";

function without<T>(items: T[], index: number): T[] {
  const copy = items.slice();
  copy.splice(index, 1);
  return copy;
}

function replace<T>(items: T[], index: number, item: T): T[] {
  const copy = items.slice();
  copy[index] = item;
  return copy;
}

/** Rewrite payloads without erasing callback or host-task boundaries. */
function leaves(s: Scenario, change: (leaf: Leaf) => Leaf): Scenario {
  let turns = s.turns;
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!("steps" in turn)) continue;
    let steps = turn.steps;
    for (let j = 0; j < steps.length; j++) {
      const step = steps[j];
      let next: Step = step;
      if (step.op === "queue") {
        const payload = queuedSteps(step);
        let changed = payload;
        for (let k = 0; k < payload.length; k++) {
          const value = change(payload[k]);
          if (value !== payload[k]) {
            if (changed === payload) changed = payload.slice();
            changed[k] = value;
          }
        }
        if (changed !== payload)
          next = step.step ? { ...step, step: changed[0] } : { ...step, steps: changed };
      } else if (step.op !== "cancel") next = change(step);
      if (next !== step) {
        if (steps === turn.steps) steps = steps.slice();
        steps[j] = next;
      }
    }
    if (steps !== turn.steps) {
      if (turns === s.turns) turns = s.turns.slice();
      turns[i] = { steps };
    }
  }
  return turns === s.turns ? s : { ...s, turns };
}

/** A failed loose resolve used to retain its node/key fields after becoming a
 * noop. Clean the representation, but keep the noop's scheduling position. */
export function canonicalize(s: Scenario): Scenario {
  return leaves(s, leaf => {
    if (leaf.op === "noop") for (const key in leaf) if (key !== "op") return { op: "noop" };
    return leaf;
  });
}

function removeReader(s: Scenario, id: number): Scenario {
  const removed = new Set([id]);
  const readers: ReaderSpec[] = [];
  // Parents precede children; removing a region removes its subtree.
  for (const r of s.readers) {
    if (r.parent !== undefined && removed.has(r.parent)) removed.add(r.id);
    if (!removed.has(r.id)) readers.push(r);
  }
  return leaves({ ...s, readers }, leaf =>
    (leaf.op === "mount" || leaf.op === "dispose" || leaf.op === "click") &&
    removed.has(leaf.reader)
      ? { op: "noop" }
      : leaf
  );
}

function replaceRef(refs: number[], from: number, to: number): number[] {
  let result = refs;
  for (let i = 0; i < refs.length; i++)
    if (refs[i] === from) {
      if (result === refs) result = refs.slice();
      result[i] = to;
    }
  return result;
}

/** Possible numeric inputs, in read order, without repeated candidates. */
function inputRefs(n: MemoSpec): number[] {
  const refs: number[] = [];
  for (const ref of n.deps) if (!refs.includes(ref)) refs.push(ref);
  if (n.branch) for (const ref of n.branch.otherwise) if (!refs.includes(ref)) refs.push(ref);
  return refs;
}

/** Replace richer observation mechanisms with simpler existing ones. These
 * change ownership/attachment and must replay; they are not normalizations. */
export function* observationReductions(s: Scenario): Generator<Scenario> {
  let usesShow = s.version === 2 && s.anchorShow !== false;
  const addressed = new Set<number>();
  for (const r of s.readers) if (r.gated) usesShow = true;
  for (const turn of s.turns) {
    if (!("steps" in turn)) continue;
    for (const step of turn.steps) {
      const payload = step.op === "queue" ? queuedSteps(step) : [step];
      for (const leaf of payload) {
        if (leaf.op === "show") usesShow = true;
        if (leaf.op === "mount" || leaf.op === "dispose" || leaf.op === "click")
          addressed.add(leaf.reader);
      }
    }
  }
  for (let i = 0; i < s.readers.length; i++) {
    const r = s.readers[i];
    // Reuse the global visibility signal only when it has no existing users
    // or setters. Other independently mounted readers keep their controls.
    if (!usesShow && r.mounted !== undefined) {
      const reader = { ...r, gated: true };
      delete reader.mounted;
      yield leaves({ ...s, show: r.mounted, readers: replace(s.readers, i, reader) }, x =>
        x.op === "mount" && x.reader === r.id ? { op: "show", value: x.value } : x
      );
    }
    if (
      s.version !== 2 ||
      r.gated ||
      r.boundary !== "none" ||
      r.parent !== undefined ||
      r.mounted !== undefined ||
      r.pending ||
      r.render ||
      addressed.has(r.id)
    )
      continue;
    const anchors = anchorIds(s);
    const projected = anchors.slice();
    const refs: number[] = [];
    let sources = 0;
    for (const ref of r.refs) {
      if (ref >= 0) refs.push(ref);
      else {
        sources++;
        if (!projected.includes(ref)) projected.push(ref);
      }
    }
    if (!sources || (!refs.length && projected.length === anchors.length)) continue;
    yield {
      ...s,
      readers: refs.length ? replace(s.readers, i, { ...r, refs }) : without(s.readers, i),
      anchors: projected
    };
  }
}

/** Replace observation scaffolding with one fixed data reader. This is a
 * new observation shape, not a claim that boundaries or effects are equivalent. */
export function* observationCollapseReductions(s: Scenario): Generator<Scenario> {
  if (!s.readers.length) return;
  for (const r of s.readers) if (r.render) return;
  const first = s.readers[0];
  if (
    s.readers.length === 1 &&
    !first.gated &&
    first.boundary === "none" &&
    first.mounted === undefined &&
    !first.pending
  )
    return;
  const refs: number[] = [];
  for (const r of s.readers) for (const ref of r.refs) if (!refs.includes(ref)) refs.push(ref);
  const candidate = leaves(
    { ...s, readers: [{ id: first.id, refs, gated: false, boundary: "none" }] },
    x => (x.op === "mount" || x.op === "dispose" || x.op === "click" ? { op: "noop" } : x)
  );
  yield pruneCoordinated(candidate);
}

/** These intentionally change the program, including its optimistic lifetime. */
export function* lifecycleReductions(s: Scenario): Generator<Scenario> {
  const o = s.optimistic;
  if (!o || s.actions || s.warmLatest?.length) return;
  if (o.kind === "latest")
    yield { ...s, optimistic: { ...o, kind: "override", viaMemo: undefined } };

  if (o.proposals.length === 1 && o.proposals[0] === 0 && o.authoritative !== 0)
    for (let i = 0; i < s.turns.length; i++) {
      const t = s.turns[i];
      if (!("steps" in t)) continue;
      for (let j = 1; j < t.steps.length; j++)
        if (t.steps[j - 1].op === "start-action" && t.steps[j].op === "resume-action")
          yield {
            ...s,
            optimistic: { ...o, proposals: [o.authoritative], authoritative: 0 },
            turns: replace(s.turns, i, { steps: without(t.steps, j) })
          };
    }

  if (s.version !== 2 || s.sources?.length !== 2 || s.anchors?.includes(-1)) return;
  for (const n of s.nodes) if (dependencies(n).includes(-1)) return;
  for (const r of s.readers) if (r.refs.includes(-1) || r.render?.on === -1) return;
  for (const t of s.turns) {
    if (!("steps" in t)) return;
    for (const x of t.steps)
      if (
        x.op === "queue" ||
        x.op === "cancel" ||
        x.op === "resolve" ||
        (x.op === "read" && x.ref === -1) ||
        (x.op === "write" && (x.source ?? -1) === -1)
      )
        return;
  }
  let proposal = -1;
  const rewritten = leaves(s, x => {
    if (x.op === "start-action") {
      if (proposal !== -1) return { op: "noop" };
      proposal = 0;
      return { op: "write", source: -2, value: o.proposals[0] };
    }
    if (x.op === "resume-action") {
      if (proposal < 0 || proposal >= o.proposals.length) return { op: "noop" };
      proposal++;
      return {
        op: "write",
        source: -2,
        value: proposal < o.proposals.length ? o.proposals[proposal] : o.authoritative
      };
    }
    return x;
  });
  // Both roles become one ordinary source. A later implicit action completion
  // disappears; discovery checks the resulting program, not lifetime equivalence.
  yield mergeSource({ ...rewritten, optimistic: undefined }, -2);
}

/** Remove one queue boundary as an enabling edit, then let ordinary pruning run. */
export function* scheduleReductions(s: Scenario): Generator<Scenario> {
  for (let i = 0; i < s.turns.length; i++) {
    const t = s.turns[i];
    if (!("steps" in t)) continue;
    for (let j = 0; j < t.steps.length; j++) {
      const q = t.steps[j];
      if (q.op !== "queue" || q.via !== "microtask") continue;
      const payload = queuedSteps(q);
      if (payload.length !== 1 || payload[0].op !== "show") continue;
      let addressed = false;
      for (const turn of s.turns) {
        if ("task" in turn) {
          if (turn.task === q.id) addressed = true;
        } else
          for (const step of turn.steps)
            if (step.op === "cancel" && step.id === q.id) addressed = true;
      }
      if (addressed) continue;
      const turns = s.turns.slice();
      turns.splice(i, 1, { steps: without(t.steps, j) }, { steps: payload.slice() });
      yield { ...s, turns };
    }
  }
}

/** Collapse [source, affine(source)] while translating its selected async flight. */
export function* coneReductions(s: Scenario): Generator<Scenario> {
  for (const parent of s.nodes) {
    const source = parent.deps[0];
    if (parent.delivery !== "sync" || parent.branch || source >= 0) continue;
    if (parent.deps.some(ref => ref !== source)) continue;
    let child: MemoSpec | undefined;
    let shared = false;
    for (const n of s.nodes)
      if (dependencies(n).includes(parent.id)) {
        if (child) shared = true;
        child = n;
      }
    if (!child || shared || child.delivery === "sync" || child.branch) continue;
    const position = child.deps.indexOf(source);
    if (position < 0 || child.deps.some(ref => ref !== source && ref !== parent.id)) continue;
    if (s.warmLatest?.includes(parent.id)) continue;
    if (s.readers.some(r => r.refs.includes(parent.id) || r.render?.on === parent.id)) continue;
    for (const turn of s.turns)
      if ("steps" in turn)
        for (const step of turn.steps)
          for (const x of step.op === "queue" ? queuedSteps(step) : [step])
            if (x.op === "read" && x.ref === parent.id) shared = true;
    if (shared) continue;
    const translated = translateQuestions(s, child.id, inputs => {
      if (inputs.length !== child.deps.length) return;
      const value = inputs[position];
      const sum = value * parent.deps.length;
      const product = sum * parent.factor;
      const derived = product + parent.offset;
      if (![sum, product, derived].every(Number.isSafeInteger)) return;
      for (let i = 0; i < inputs.length; i++)
        if (inputs[i] !== (child.deps[i] === source ? value : derived)) return;
      return [value];
    });
    if (!translated) continue;
    const nodes: MemoSpec[] = [];
    for (const n of s.nodes)
      if (n.id !== parent.id)
        nodes.push(n === child ? { ...n, deps: [source], factor: 1, offset: 0 } : n);
    yield { ...translated, nodes };
  }
}

/** Finish a coordinated graph edit without spending replays deleting dead nodes. */
function pruneCoordinated(s: Scenario): Scenario {
  for (const candidate of pruningReductions(s)) s = candidate;
  return s;
}

/** Fold a conditional into its consumer, or shorten both paths together.
 * These remove reactive boundaries intentionally; they are not equivalences. */
export function* branchReductions(s: Scenario): Generator<Scenario> {
  for (let i = 0; i < s.nodes.length; i++) {
    const n = s.nodes[i];
    if (!n.branch) continue;
    if (n.factor === 1 && n.offset === 0)
      for (let j = i + 1; j < s.nodes.length; j++) {
        const child = s.nodes[j];
        if (child.branch || !child.deps.includes(n.id)) continue;
        const deps: number[] = [],
          otherwise: number[] = [];
        for (const ref of child.deps) {
          if (ref === n.id) {
            deps.push(...n.deps);
            otherwise.push(...n.branch.otherwise);
          } else {
            deps.push(ref);
            otherwise.push(ref);
          }
        }
        // Retain exact keys on surviving computations. If the changed tuple no
        // longer reaches a selected flight, normal strict replay rejects it.
        yield pruneCoordinated({
          ...s,
          nodes: replace(s.nodes, j, {
            ...child,
            deps,
            branch: { condition: n.branch.condition, otherwise }
          })
        });
      }

    // A chain in each arm can require both bypasses before the bug reappears.
    // Try immediate upstream inputs only, avoiding arbitrary expression search.
    for (let a = 0; a < n.deps.length; a++) {
      const left = s.nodes.find(p => p.id === n.deps[a]);
      if (!left) continue;
      for (let b = 0; b < n.branch.otherwise.length; b++) {
        const right = s.nodes.find(p => p.id === n.branch!.otherwise[b]);
        if (!right) continue;
        for (const x of inputRefs(left))
          for (const y of inputRefs(right))
            yield pruneCoordinated({
              ...s,
              nodes: replace(s.nodes, i, {
                ...n,
                deps: replace(n.deps, a, x),
                branch: { ...n.branch, otherwise: replace(n.branch.otherwise, b, y) }
              })
            });
      }
    }
  }
}

/** A short menu of alternative event boundaries, not arbitrary permutations. */
function* eventAlternatives(s: Scenario): Generator<Scenario> {
  for (let i = 0; i < s.turns.length; i++) {
    const t = s.turns[i];
    if (!("steps" in t)) continue;
    for (let j = 1; j < t.steps.length - 1; j++) {
      if (t.steps[j].op !== "flush") continue;
      const turns = s.turns.slice();
      turns.splice(i, 1, { steps: t.steps.slice(0, j) }, { steps: t.steps.slice(j + 1) });
      yield { ...s, turns };
    }
  }
}

/** Change async mechanisms as a group, optionally with a scheduler boundary.
 * Paired edits are replayed directly, even if either edit alone would pass.
 * The shrinker's shared seen set and budget bound this alternative search. */
export function* deliveryScheduleReductions(s: Scenario): Generator<Scenario> {
  let count = 0;
  for (const n of s.nodes) if (n.delivery !== "sync") count++;
  if (!count) return;
  for (const delivery of ["promise", "manual", "await", "sync"] as const) {
    let nodes = s.nodes;
    const changed = new Set<number>();
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      if (n.delivery === "sync" || n.delivery === delivery) continue;
      if (nodes === s.nodes) nodes = s.nodes.slice();
      nodes[i] = { ...n, delivery };
      changed.add(n.id);
    }
    let candidate = nodes === s.nodes ? s : { ...s, nodes };
    if (delivery !== "manual" && changed.size)
      candidate = leaves(candidate, x =>
        x.op === "resolve" && changed.has(x.node) ? { op: "noop" } : x
      );
    // Automatic promise/sync forms are preferred. Manual gates and an extra
    // await are enabling edits only: pair them with removing a flush or node.
    // This avoids spending the budget cycling through equivalent-size forms.
    if (candidate !== s && (delivery === "promise" || delivery === "sync")) yield candidate;
    yield* eventAlternatives(candidate);
    if (candidate !== s && (delivery === "manual" || delivery === "await"))
      for (let i = 0; i < candidate.nodes.length; i++)
        for (const ref of inputRefs(candidate.nodes[i]))
          yield pruneCoordinated(bypass(candidate, i, ref));
  }
  // Keep mixed delivery when it matters. Changing one memo's async boundary
  // and bypassing another is a bounded two-edit candidate, not a recursive
  // search through arbitrary passing programs.
  for (let i = 0; i < s.nodes.length; i++) {
    const n = s.nodes[i];
    for (const delivery of ["promise", "manual", "await"] as const) {
      if (n.delivery === delivery) continue;
      let candidate = { ...s, nodes: replace(s.nodes, i, { ...n, delivery }) };
      if (delivery !== "manual")
        candidate = leaves(candidate, x =>
          x.op === "resolve" && x.node === n.id ? { op: "noop" } : x
        );
      for (let j = 0; j < s.nodes.length; j++) {
        if (i === j) continue;
        for (const ref of inputRefs(s.nodes[j])) yield pruneCoordinated(bypass(candidate, j, ref));
      }
    }
  }
}

/** A merge can destroy old/new answer equality. Try a small offset repair in
 * the same candidate; strict replay decides whether the new program fails. */
export function* mergeArithmeticReductions(s: Scenario): Generator<Scenario> {
  if (s.version !== 2 || s.optimistic || s.sources!.length < 2) return;
  for (const source of s.sources!) {
    if (source === -1) continue;
    const merged = mergeSource(s, source);
    for (let i = 0; i < merged.nodes.length; i++)
      for (const offset of [0, 1, -1, 2]) {
        const n = merged.nodes[i];
        if (offset === n.offset) continue;
        yield { ...merged, nodes: replace(merged.nodes, i, { ...n, offset }) };
      }
  }
}

/** Reordering alone or changing delivery alone may hide the failure. Prefer
 * one canonical direction; allow an uphill pivot only with cone removal. */
export function* deliveryOrderingReductions(s: Scenario): Generator<Scenario> {
  const key = scenarioKey(s);
  function* offer(candidate: Scenario): Generator<Scenario> {
    if (validate(candidate)) return;
    const named = normalize(candidate);
    if (candidate.nodes.length < s.nodes.length || JSON.stringify(named) < key) yield named;
  }
  for (let i = 0; i < s.nodes.length; i++) {
    const n = s.nodes[i];
    for (const delivery of ["promise", "manual", "await"] as const) {
      if (delivery === n.delivery) continue;
      const nodes = replace(s.nodes, i, { ...n, delivery });
      // Leave exact keys intact: unlike removal, changing the delivery here
      // does not excuse silently resolving a different request.
      for (let j = 1; j < nodes.length; j++) {
        const reordered = nodes.slice();
        reordered[j - 1] = nodes[j];
        reordered[j] = nodes[j - 1];
        const candidate = { ...s, nodes: reordered };
        if (validate(candidate)) continue;
        yield* offer(candidate);
        for (const cone of coneReductions(candidate)) yield* offer(pruneCoordinated(cone));
      }
    }
  }
}

/** Append an uncanceled queued callback after the enclosing callback's work.
 * This changes batching intentionally, while preserving the other operations. */
export function* callbackEndReductions(s: Scenario): Generator<Scenario> {
  for (let i = 0; i < s.turns.length; i++) {
    const t = s.turns[i];
    if (!("steps" in t)) continue;
    for (let j = 0; j < t.steps.length; j++) {
      const q = t.steps[j];
      if (q.op !== "queue" || q.via === "task") continue;
      let addressed = false;
      for (const turn of s.turns) {
        if ("task" in turn) {
          if (turn.task === q.id) addressed = true;
        } else
          for (const step of turn.steps)
            if (step.op === "cancel" && step.id === q.id) addressed = true;
      }
      if (addressed) continue;
      const steps = without(t.steps, j);
      steps.push(...queuedSteps(q));
      yield { ...s, turns: replace(s.turns, i, { steps }) };
    }
  }
}

/** Absorb the first visibility setter even when its event contains other work. */
export function* initialVisibilityReductions(s: Scenario): Generator<Scenario> {
  const first = s.turns[0];
  if (!first || !("steps" in first)) return;
  for (let i = 0; i < first.steps.length; i++) {
    const step = first.steps[i];
    if (step.op !== "show") continue;
    yield {
      ...s,
      show: step.value,
      turns: replace(s.turns, 0, { steps: without(first.steps, i) })
    };
    break;
  }
}

/** Bypass one use of a memo while retaining its other consumers and flights.
 * Whole-node bypass can erase the other observation path needed by a failure.
 * Inputs always come from upstream, so these edits cannot introduce cycles. */
export function* edgeReductions(s: Scenario): Generator<Scenario> {
  for (let i = 0; i < s.readers.length; i++) {
    const r = s.readers[i];
    for (let j = 0; j < r.refs.length; j++) {
      const n = s.nodes.find(n => n.id === r.refs[j]);
      if (!n) continue;
      for (const ref of inputRefs(n))
        yield {
          ...s,
          readers: replace(s.readers, i, { ...r, refs: replace(r.refs, j, ref) })
        };
    }
  }
  for (let i = 0; i < s.nodes.length; i++) {
    const n = s.nodes[i];
    for (const field of ["deps", "otherwise"] as const) {
      const refs = field === "deps" ? n.deps : n.branch?.otherwise;
      if (!refs) continue;
      for (let j = 0; j < refs.length; j++) {
        const parent = s.nodes.find(n => n.id === refs[j]);
        if (!parent) continue;
        for (const ref of inputRefs(parent)) {
          const changed = replace(refs, j, ref);
          const node =
            field === "deps"
              ? { ...n, deps: changed }
              : { ...n, branch: { ...n.branch!, otherwise: changed } };
          yield {
            ...s,
            nodes: replace(s.nodes, i, node)
          };
        }
      }
    }
  }
}

/** Bypass a computation as an experiment, not as an identity law: even a sync
 * identity changes observation and entanglement. All surviving flight keys
 * stay exact; a downstream request that no longer exists rejects the trial. */
function bypass(s: Scenario, index: number, to: number): Scenario {
  const from = s.nodes[index].id;
  const nodes: MemoSpec[] = [];
  for (const n of s.nodes) {
    if (n.id === from) continue;
    const deps = replaceRef(n.deps, from, to);
    let branch = n.branch;
    if (branch) {
      const otherwise = replaceRef(branch.otherwise, from, to);
      const condition = branch.condition === from ? to : branch.condition;
      if (otherwise !== branch.otherwise || condition !== branch.condition)
        branch = { condition, otherwise };
    }
    nodes.push(deps === n.deps && branch === n.branch ? n : { ...n, deps, branch });
  }
  const readers: ReaderSpec[] = [];
  for (const r of s.readers) {
    const refs = replaceRef(r.refs, from, to);
    const render = r.render?.on === from ? { ...r.render, on: to } : r.render;
    readers.push(refs === r.refs && render === r.render ? r : { ...r, refs, render });
  }
  return leaves(
    { ...s, nodes, readers, warmLatest: s.warmLatest && replaceRef(s.warmLatest, from, to) },
    leaf => {
      if (leaf.op === "resolve" && leaf.node === from) return { op: "noop" };
      if (leaf.op === "read" && leaf.ref === from) return { ...leaf, ref: to };
      return leaf;
    }
  );
}

function removeQueue(s: Scenario, id: number): Scenario {
  const turns: Turn[] = [];
  for (const turn of s.turns) {
    if ("task" in turn) {
      // Keep a host turn in place until a separately tested turn deletion.
      turns.push(turn.task === id ? { steps: [] } : turn);
      continue;
    }
    const steps: Step[] = [];
    for (const step of turn.steps)
      if ((step.op !== "queue" && step.op !== "cancel") || step.id !== id) steps.push(step);
    turns.push({ steps });
  }
  return { ...s, turns };
}

/** Reductions learned from manual triage. Changes in graph structure,
 * observation and delivery always need a replay (and an optional control). */
export function* pruningReductions(s: Scenario): Generator<Scenario> {
  const canonical = canonicalize(s);
  if (canonical !== s) yield canonical;

  // Remove disconnected subgraphs together: removing one leaf per replay used
  // to spend most of the budget dismantling a comparison that no longer read.
  const needed = new Set<number>();
  for (const r of s.readers) {
    for (const ref of r.refs) needed.add(ref);
    if (r.render) needed.add(r.render.on);
  }
  for (const ref of s.warmLatest ?? []) needed.add(ref);
  for (const turn of s.turns)
    if ("steps" in turn)
      for (const step of turn.steps) {
        const payload = step.op === "queue" ? queuedSteps(step) : [step];
        for (const leaf of payload) if (leaf.op === "read") needed.add(leaf.ref);
      }
  for (let i = s.nodes.length - 1; i >= 0; i--)
    if (needed.has(s.nodes[i].id)) for (const dep of dependencies(s.nodes[i])) needed.add(dep);
  const nodes: MemoSpec[] = [];
  const removed = new Set<number>();
  for (const n of s.nodes) {
    if (needed.has(n.id)) nodes.push(n);
    else removed.add(n.id);
  }
  if (removed.size)
    yield leaves({ ...s, nodes }, leaf =>
      leaf.op === "resolve" && removed.has(leaf.node) ? { op: "noop" } : leaf
    );
}

export function* structuralReductions(s: Scenario, prune = true): Generator<Scenario> {
  if (prune) yield* pruningReductions(s);
  for (let i = 0; i < s.readers.length; i++) {
    const r = s.readers[i];
    yield removeReader(s, r.id);
    // An unused mounting signal still adds an owner and an attachment effect.
    // Remove the mechanism as a replay-tested edit, not syntax normalization.
    if (r.mounted !== undefined) {
      const reader = { ...r };
      delete reader.mounted;
      yield leaves({ ...s, readers: replace(s.readers, i, reader) }, x =>
        x.op === "mount" && x.reader === r.id ? { op: "noop" } : x
      );
    }
    for (let j = 0; j < r.refs.length; j++) {
      const n = s.nodes.find(n => n.id === r.refs[j]);
      if (!n || n.delivery !== "sync" || n.branch || n.deps.length < 2) continue;
      // Read a sum's inputs directly. This deliberately removes a derivation's
      // entanglement and changes the tuple; the original fingerprint must hold.
      const refs = r.refs.slice();
      refs.splice(j, 1, ...n.deps);
      yield { ...s, readers: replace(s.readers, i, { ...r, refs }) };
    }
    if (r.refs.length > 1)
      for (let j = 0; j < r.refs.length; j++)
        yield { ...s, readers: replace(s.readers, i, { ...r, refs: without(r.refs, j) }) };
    if (r.gated) yield { ...s, readers: replace(s.readers, i, { ...r, gated: false }) };
    if (r.boundary === "reset")
      yield { ...s, readers: replace(s.readers, i, { ...r, boundary: "retain" }) };
  }
  if (s.warmLatest)
    for (let i = 0; i < s.warmLatest.length; i++)
      yield { ...s, warmLatest: without(s.warmLatest, i) };
  if (s.optimistic?.viaMemo) yield { ...s, optimistic: { ...s.optimistic, viaMemo: false } };

  for (let i = 0; i < s.nodes.length; i++) {
    const n = s.nodes[i];
    const choices = new Set(dependencies(n));
    for (const dep of choices) yield bypass(s, i, dep);
    if (n.delivery !== "sync") {
      const delivery =
        n.delivery === "await" ? "manual" : n.delivery === "manual" ? "promise" : "sync";
      // These completions belong to the removed async mechanism, never to a
      // different pending request. Keep their event-loop slots as noops.
      const candidate = { ...s, nodes: replace<MemoSpec>(s.nodes, i, { ...n, delivery }) };
      yield delivery === "manual"
        ? candidate
        : leaves(candidate, leaf =>
            leaf.op === "resolve" && leaf.node === n.id ? { op: "noop" } : leaf
          );
      if (delivery !== "sync")
        yield leaves(
          { ...s, nodes: replace<MemoSpec>(s.nodes, i, { ...n, delivery: "sync" }) },
          leaf => (leaf.op === "resolve" && leaf.node === n.id ? { op: "noop" } : leaf)
        );
    }
    if (n.deps.length > 1)
      for (let j = 0; j < n.deps.length; j++)
        yield { ...s, nodes: replace<MemoSpec>(s.nodes, i, { ...n, deps: without(n.deps, j) }) };
    if (n.branch && n.branch.otherwise.length > 1)
      for (let j = 0; j < n.branch.otherwise.length; j++)
        yield {
          ...s,
          nodes: replace<MemoSpec>(s.nodes, i, {
            ...n,
            branch: { ...n.branch, otherwise: without(n.branch.otherwise, j) }
          })
        };
  }

  for (let i = 0; i < s.turns.length; i++) {
    const turn = s.turns[i];
    if (!("steps" in turn)) continue;
    for (let j = 0; j < turn.steps.length; j++) {
      const step = turn.steps[j];
      if (step.op === "queue") {
        yield removeQueue(s, step.id);
        // Inline only a queued callback, not a task invocation elsewhere. The
        // trial is allowed to fail if the async boundary was load-bearing.
        if (step.via !== "task") {
          const candidate = removeQueue(s, step.id);
          const changed = candidate.turns[i];
          if ("steps" in changed) changed.steps.splice(j, 0, ...queuedSteps(step));
          yield candidate;
        }
      }
      const payload = step.op === "queue" ? queuedSteps(step) : [step];
      for (let k = 0; k < payload.length; k++) {
        const leaf = payload[k];
        if (leaf.op !== "write") continue;
        for (const value of [0, 1]) {
          if (leaf.value === value || (value === 1 && leaf.value === 0)) continue;
          const changed = { ...leaf, value };
          let next: Step = changed;
          if (step.op === "queue")
            next = step.step
              ? { ...step, step: changed }
              : { ...step, steps: replace(queuedSteps(step), k, changed) };
          yield { ...s, turns: replace(s.turns, i, { steps: replace(turn.steps, j, next) }) };
        }
      }
    }
  }
}

/** Merge an ordinary input into the primary input as a tested simplification.
 * This can change entanglement. Optimistic truth/overlay roles are never merged,
 * and exact async questions are deliberately not translated to new values. */
function mergeSource(s: Scenario, from: number): Scenario {
  const to = -1;
  const nodes: MemoSpec[] = [];
  for (const n of s.nodes)
    nodes.push({
      ...n,
      deps: replaceRef(n.deps, from, to),
      branch: n.branch && {
        condition: n.branch.condition === from ? to : n.branch.condition,
        otherwise: replaceRef(n.branch.otherwise, from, to)
      }
    });
  const readers: ReaderSpec[] = [];
  for (const r of s.readers)
    readers.push({
      ...r,
      refs: replaceRef(r.refs, from, to),
      render: r.render?.on === from ? { ...r.render, on: to } : r.render
    });
  const sources: number[] = [];
  for (const id of s.sources!) if (id !== from) sources.push(id);
  let anchors: number[] | undefined;
  if (s.anchors) {
    anchors = [];
    for (const id of s.anchors) {
      const next = id === from ? to : id;
      if (!anchors.includes(next)) anchors.push(next);
    }
  }
  let actions = s.actions;
  if (actions) {
    actions = [];
    for (const a of s.actions!) {
      const segments: typeof a.segments = [];
      for (const segment of a.segments) {
        const writes: typeof segment = [];
        for (const w of segment) writes.push(w.source === from ? { ...w, source: to } : w);
        segments.push(writes);
      }
      actions.push({ ...a, segments });
    }
  }
  return leaves(
    {
      ...s,
      sources,
      anchors,
      nodes,
      readers,
      actions,
      warmLatest: s.warmLatest && replaceRef(s.warmLatest, from, to)
    },
    x => {
      if (x.op === "write" && x.source === from) return { ...x, source: to };
      if (x.op === "read" && x.ref === from) return { ...x, ref: to };
      return x;
    }
  );
}

/** Patterns remaining in the real minimized corpus. None is an oracle law:
 * moving setup into initial state or changing an async boundary needs replay. */
export function* focusedReductions(s: Scenario): Generator<Scenario> {
  // v1's retained-disposal allowance only covers ungated readers with no
  // boundaries. Outside that scope, try the explicit single-source format.
  // Replay still checks the fingerprint; do not normalize all v1 cases away.
  if (s.version === 1 && s.readers.some(r => r.gated || r.boundary !== "none"))
    yield { ...s, version: 2, sources: [-1] };

  const renamed = identityValues(s);
  if (renamed) yield renamed;

  // Compose the arithmetic while testing the loss of the intermediate
  // dependency. Dead-parent pruning happens in the usual structural pass.
  for (let i = 0; i < s.nodes.length; i++) {
    const child = s.nodes[i];
    if (child.branch || child.deps.length !== 1) continue;
    const parent = s.nodes.find(n => n.id === child.deps[0]);
    if (!parent || parent.delivery !== "sync" || parent.branch || parent.deps.length !== 1)
      continue;
    const candidate = {
      ...s,
      nodes: replace(s.nodes, i, {
        ...child,
        deps: [parent.deps[0]],
        factor: parent.factor * child.factor,
        offset: parent.offset * child.factor + child.offset
      })
    };
    yield candidate;
    const translated = affineQuestions(candidate, child.id, parent);
    if (translated && translated !== candidate) yield translated;
  }

  // Remove a leading proposal together with the resume that would otherwise
  // advance past the desired replacement. Keep the start and action lifetime.
  if (s.optimistic && s.optimistic.proposals.length > 1) {
    let removed = false;
    let started = false;
    const changed = leaves(s, x => {
      if (x.op === "start-action") started = true;
      if (started && !removed && x.op === "resume-action") {
        removed = true;
        return { op: "noop" };
      }
      return x;
    });
    if (removed)
      yield {
        ...changed,
        optimistic: {
          ...s.optimistic,
          proposals: s.optimistic.proposals.slice(1)
        }
      };
  }

  // Move a reader's first unmount into initial state as one coordinated edit.
  // Unlike flipping the initial flag alone, this removes an operation too.
  for (let i = 0; i < s.readers.length; i++) {
    const reader = s.readers[i];
    if (reader.mounted !== true) continue;
    let found = false;
    let removed = false;
    const changed = leaves(s, x => {
      if (!found && x.op === "mount" && x.reader === reader.id) {
        found = true;
        if (!x.value) {
          removed = true;
          return { op: "noop" };
        }
      }
      return x;
    });
    if (removed)
      yield { ...changed, readers: replace(s.readers, i, { ...reader, mounted: false }) };
  }

  const first = s.turns[0];
  if (
    s.show &&
    first &&
    "steps" in first &&
    first.steps.length === 1 &&
    first.steps[0].op === "show" &&
    !first.steps[0].value
  )
    yield { ...s, show: false, turns: s.turns.slice(1) };

  if (!s.show) yield { ...s, show: true };
  for (let i = 0; i < s.readers.length; i++)
    if (s.readers[i].mounted === false)
      yield { ...s, readers: replace(s.readers, i, { ...s.readers[i], mounted: true }) };

  if (s.version === 2 && !s.optimistic)
    for (const id of s.sources!) if (id !== -1) yield mergeSource(s, id);

  // Trying zero alone misses bugs which need a change from the initial zero.
  if (s.optimistic) {
    const o = s.optimistic;
    for (let i = 0; i < o.proposals.length; i++)
      if (o.proposals[i] !== 0 && o.proposals[i] !== 1)
        yield { ...s, optimistic: { ...o, proposals: replace(o.proposals, i, 1) } };
    if (o.authoritative !== 0 && o.authoritative !== 1)
      yield { ...s, optimistic: { ...o, authoritative: 1 } };
  }
  for (let i = 0; i < (s.actions?.length ?? 0); i++) {
    const action = s.actions![i];
    for (let j = 0; j < action.segments.length; j++) {
      const segment = action.segments[j];
      for (let k = 0; k < segment.length; k++) {
        const w = segment[k];
        for (const value of [0, 1]) {
          if (w.value === value || (value === 1 && w.value === 0)) continue;
          const segments = replace(action.segments, j, replace(segment, k, { ...w, value }));
          yield { ...s, actions: replace(s.actions!, i, { ...action, segments }) };
        }
      }
    }
  }

  // Some branch repros need the old derived answer to equal the new input.
  // Shrinking the offset or write alone destroys that equality. Try their
  // shared literal together; derived arithmetic is not assumed equivalent,
  // and surviving request keys still reject a changed question.
  const offsets = new Set<number>();
  for (const n of s.nodes) if (n.offset > 1) offsets.add(n.offset);
  for (const offset of offsets) {
    const changed = leaves(s, x =>
      x.op === "write" && x.value === offset ? { ...x, value: 1 } : x
    );
    if (changed === s) continue;
    const nodes: MemoSpec[] = [];
    for (const n of s.nodes) nodes.push(n.offset === offset ? { ...n, offset: 1 } : n);
    yield { ...changed, nodes };
  }

  // Dropping setup alone can leave write(0), which no longer changes the
  // initial zero. Try dropping the prefix and retaining a changing write
  // together. Any surviving exact request must still match on replay.
  for (let i = 1; i < s.turns.length; i++) {
    const turn = s.turns[i];
    if (!("steps" in turn) || turn.steps[0]?.op !== "write" || turn.steps[0].value !== 0) continue;
    const turns = s.turns.slice(i);
    turns[0] = { steps: replace(turn.steps, 0, { ...turn.steps[0], value: 1 }) };
    yield { ...s, turns };
  }

  const noReads = leaves(s, x => (x.op === "read" ? { op: "noop" } : x));
  if (noReads !== s) yield noReads;

  for (let i = 0; i < s.turns.length; i++) {
    const turn = s.turns[i];
    if (!("steps" in turn)) continue;
    for (let j = 0; j < turn.steps.length; j++) {
      const step = turn.steps[j];
      if (step.op === "flush" && j > 0 && j + 1 < turn.steps.length) {
        const turns = s.turns.slice();
        turns.splice(i, 1, { steps: turn.steps.slice(0, j) }, { steps: turn.steps.slice(j + 1) });
        yield { ...s, turns };
      }
      if (step.op !== "queue") continue;
      if (step.via === "promise" || step.via === "await")
        yield {
          ...s,
          turns: replace(s.turns, i, {
            steps: replace(turn.steps, j, { ...step, via: "microtask" })
          })
        };
      if (step.via !== "task") {
        // A final microtask callback can sometimes be a plain next event.
        // Do not move it past another operation in its containing callback.
        if (j === turn.steps.length - 1) {
          const turns = s.turns.slice();
          turns.splice(
            i,
            1,
            { steps: replace<Step>(turn.steps, j, { op: "noop" }) },
            { steps: queuedSteps(step) }
          );
          yield { ...s, turns };
        }
        continue;
      }
      let canceled = false;
      let invocation = -1;
      let repeated = false;
      for (let k = 0; k < s.turns.length; k++) {
        const t = s.turns[k];
        if ("task" in t) {
          if (t.task === step.id) {
            if (invocation >= 0) repeated = true;
            invocation = k;
          }
        } else for (const x of t.steps) if (x.op === "cancel" && x.id === step.id) canceled = true;
      }
      if (canceled || repeated) continue;
      // Keep the invocation at its own host turn, not at the queue site.
      const turns = replace(s.turns, i, { steps: replace<Step>(turn.steps, j, { op: "noop" }) });
      const delivered = { steps: queuedSteps(step) };
      if (invocation >= 0) turns[invocation] = delivered;
      else turns.push(delivered); // previously delivered by the external-task suffix
      yield { ...s, turns };
    }
  }
}

/** Only identity computations permit arbitrary data-label renaming: every
 * captured answer is one of the inputs. No arithmetic, branches or -0.
 * Rename exact request inputs with the same bijection, retaining owner and
 * occurrence. This is not a fallback to another live request. */
export function identityValues(s: Scenario): Scenario | undefined {
  for (const n of s.nodes)
    if (n.branch || n.deps.length !== 1 || n.factor !== 1 || n.offset !== 0) return;
  const labels = new Map<number, number>([[0, 0]]);
  let invalid = false;
  let changed = false;
  const add = (value: number) => {
    if (!Number.isFinite(value) || Object.is(value, -0)) invalid = true;
    if (!labels.has(value)) {
      const label = labels.size;
      labels.set(value, label);
      if (label !== value) changed = true;
    }
  };
  if (s.optimistic) {
    for (const value of s.optimistic.proposals) add(value);
    add(s.optimistic.authoritative);
  }
  for (const a of s.actions ?? [])
    for (const segment of a.segments) for (const w of segment) add(w.value);
  leaves(s, x => {
    if (x.op === "write") add(x.value);
    return x;
  });
  if (invalid || !changed) return;
  const key = (text: string, owner: number): string => {
    const match = /^(\d+):(\[[^\n]*\])#([1-9]\d*)$/.exec(text);
    if (!match || match[1] !== String(owner)) {
      invalid = true;
      return text;
    }
    try {
      const inputs = JSON.parse(match[2]);
      if (
        !Array.isArray(inputs) ||
        inputs.length !== 1 ||
        JSON.stringify(inputs) !== match[2] ||
        !labels.has(inputs[0])
      ) {
        invalid = true;
        return text;
      }
      return `${match[1]}:[${labels.get(inputs[0])}]#${match[3]}`;
    } catch {
      invalid = true;
      return text;
    }
  };
  const result = leaves(s, x => {
    if (x.op === "write") return { ...x, value: labels.get(x.value)! };
    if (x.op !== "resolve") return x;
    let variantKeys = x.variantKeys;
    if (variantKeys) {
      variantKeys = [];
      for (const k of x.variantKeys!) variantKeys.push(k === null ? null : key(k, x.node));
    }
    return { ...x, key: x.key === undefined ? undefined : key(x.key, x.node), variantKeys };
  });
  if (invalid) return;
  let optimistic = s.optimistic;
  if (optimistic) {
    const proposals: number[] = [];
    for (const value of optimistic.proposals) proposals.push(labels.get(value)!);
    optimistic = { ...optimistic, proposals, authoritative: labels.get(optimistic.authoritative)! };
  }
  let actions = s.actions;
  if (actions) {
    actions = [];
    for (const a of s.actions!) {
      const segments: typeof a.segments = [];
      for (const segment of a.segments) {
        const writes: typeof segment = [];
        for (const w of segment) writes.push({ ...w, value: labels.get(w.value)! });
        segments.push(writes);
      }
      actions.push({ ...a, segments });
    }
  }
  return { ...result, optimistic, actions };
}

/** These coordinated edits can cross equality thresholds that individual
 * literal/edge deletions cannot. Exact questions remain unchanged: a replay
 * rejects the candidate when it would resolve a different request. */
export function* arithmeticReductions(s: Scenario): Generator<Scenario> {
  // Small dependency lists: avoid a Set allocation for the common unique case.
  const unique = (refs: number[]) => {
    let result = refs;
    for (let i = 0; i < refs.length; i++) {
      if (refs.indexOf(refs[i]) !== i) {
        if (result === refs) result = refs.slice(0, i);
      } else if (result !== refs) result.push(refs[i]);
    }
    return result;
  };
  let nodes = s.nodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i],
      deps = unique(n.deps);
    const otherwise = n.branch && unique(n.branch.otherwise);
    const factor = n.factor > 1 ? 1 : n.factor;
    const offset = n.offset > 1 ? 1 : n.offset;
    if (
      deps === n.deps &&
      otherwise === n.branch?.otherwise &&
      factor === n.factor &&
      offset === n.offset
    )
      continue;
    if (nodes === s.nodes) nodes = nodes.slice();
    nodes[i] = {
      ...n,
      deps,
      factor,
      offset,
      branch:
        n.branch && otherwise !== n.branch.otherwise
          ? { ...n.branch, otherwise: otherwise! }
          : n.branch
    };
  }
  const changed = leaves(s, x => (x.op === "write" && x.value > 1 ? { ...x, value: 1 } : x));
  if (nodes !== s.nodes || changed !== s) yield { ...changed, nodes };

  // Individual zeroing can break an equality between branches. Try removing
  // several offsets together; a single offset is already tried by nodesCandidates.
  let offsets = 0;
  for (const n of s.nodes) if (n.offset !== 0) offsets++;
  if (offsets > 1) {
    const nodes: MemoSpec[] = [];
    for (const n of s.nodes) nodes.push(n.offset === 0 ? n : { ...n, offset: 0 });
    yield { ...s, nodes };
  }

  // Move synchronous output arithmetic upstream, then let ordinary bypass
  // pruning remove the resulting identity memo. Other readers can make this
  // invalid; the graph rewrite is always tested, never assumed equivalent.
  for (let i = 0; i < s.nodes.length; i++) {
    const child = s.nodes[i];
    if (
      child.delivery !== "sync" ||
      child.branch ||
      child.deps.length !== 1 ||
      (child.factor === 1 && child.offset === 0)
    )
      continue;
    const p = s.nodes.findIndex(n => n.id === child.deps[0]);
    if (p < 0 || s.nodes[p].branch) continue;
    const parent = s.nodes[p];
    const nodes = s.nodes.slice();
    nodes[p] = {
      ...parent,
      factor: parent.factor * child.factor,
      offset: parent.offset * child.factor + child.offset
    };
    nodes[i] = { ...child, factor: 1, offset: 0 };
    yield { ...s, nodes };
  }
}

/** Invert a removed synchronous affine input in exact request keys. Retain
 * request owner and occurrence, including paired keys. Only exact safe-integer
 * inverses are supported; malformed or ambiguous questions reject the edit. */
function affineQuestions(s: Scenario, owner: number, parent: MemoSpec): Scenario | undefined {
  if (
    !Number.isSafeInteger(parent.factor) ||
    !Number.isSafeInteger(parent.offset) ||
    parent.factor === 0 ||
    (parent.factor === 1 && parent.offset === 0)
  )
    return;
  return translateQuestions(s, owner, inputs => {
    if (inputs.length !== 1) return;
    const difference = inputs[0] - parent.offset;
    const input = difference / parent.factor;
    if (
      !Number.isSafeInteger(difference) ||
      !Number.isSafeInteger(input) ||
      !Number.isSafeInteger(input * parent.factor) ||
      Object.is(input, -0) ||
      input * parent.factor + parent.offset !== inputs[0]
    )
      return;
    return [input];
  });
}

/** Exact tuple translation shared by affine inversion and cone projection. */
function translateQuestions(
  s: Scenario,
  owner: number,
  translate: (inputs: number[]) => number[] | undefined
): Scenario | undefined {
  let invalid = false;
  const key = (text: string): string => {
    const match = /^(\d+):(\[[^\n]*\])#([1-9]\d*)$/.exec(text);
    if (match && match[1] === String(owner)) {
      try {
        const inputs = JSON.parse(match[2]);
        if (
          Array.isArray(inputs) &&
          JSON.stringify(inputs) === match[2] &&
          inputs.every(x => Number.isSafeInteger(x) && !Object.is(x, -0))
        ) {
          const translated = translate(inputs);
          if (translated) return `${owner}:${JSON.stringify(translated)}#${match[3]}`;
        }
      } catch {
        // Malformed questions are not silently retargeted.
      }
    }
    invalid = true;
    return text;
  };
  const result = leaves(s, x => {
    if (x.op !== "resolve" || x.node !== owner) return x;
    let variantKeys = x.variantKeys;
    if (variantKeys) {
      variantKeys = [];
      for (const k of x.variantKeys!) variantKeys.push(k === null ? null : key(k));
    }
    return { ...x, key: x.key === undefined ? undefined : key(x.key), variantKeys };
  });
  return invalid ? undefined : result;
}

/** Start with a concrete graph/async cut, then preserve a useful visible witness.
 * Intermediate edits may pass. The completed program must fail independently. */
export function* cutReductions(s: Scenario): Generator<Scenario> {
  const weight = (x: Scenario) => {
    let total = x.nodes.length * 100;
    for (const n of x.nodes) total += Number(n.delivery !== "sync");
    return total;
  };
  const before = weight(s);
  const sources = sourceIds(s);
  for (const cut of structuralReductions(s)) {
    const c = pruneCoordinated(cut);
    if (weight(c) >= before) continue;
    for (let i = 0; i < c.readers.length; i++) {
      const r = c.readers[i];
      if (r.render || r.parent !== undefined) continue;
      const ancestors = new Set(r.refs);
      for (let j = c.nodes.length - 1; j >= 0; j--)
        if (ancestors.has(c.nodes[j].id))
          for (const ref of dependencies(c.nodes[j])) ancestors.add(ref);
      for (const source of sources) {
        if (!ancestors.has(source)) continue;
        const reader = { ...r, refs: r.refs.includes(source) ? r.refs : [source, ...r.refs] };
        delete reader.pending;
        delete reader.pendingDepth;
        const candidate = { ...c, readers: replace(c.readers, i, reader) };
        yield candidate;
        // Arithmetic compensation only after removing a node, not for every
        // delivery change; equality-sensitive branches motivate this trial.
        if (c.nodes.length < s.nodes.length && c.nodes.some(n => n.branch))
          for (let j = 0; j < c.nodes.length; j++)
            if (c.nodes[j].offset !== 1)
              yield { ...candidate, nodes: replace(c.nodes, j, { ...c.nodes[j], offset: 1 }) };
      }
    }
    if (c.nodes.length < s.nodes.length)
      for (let i = 0; i < c.nodes.length; i++)
        if (c.nodes[i].delivery !== "sync" && c.nodes[i].delivery !== "promise")
          yield { ...c, nodes: replace(c.nodes, i, { ...c.nodes[i], delivery: "promise" }) };
  }
}

/** A delivery pivot is offered only when lifecycle/scheduling work can disappear.
 * The search engine retains it only when ordinary cleanup makes a real cut. */
export function* deliveryEscapeReductions(s: Scenario): Generator<Scenario> {
  if (!s.optimistic) return;
  let scaffolding = false;
  for (const t of s.turns)
    if ("steps" in t)
      for (const step of t.steps)
        if (step.op === "resume-action" || step.op === "queue") scaffolding = true;
  if (!scaffolding) return;
  for (let i = 0; i < s.nodes.length; i++)
    if (s.nodes[i].delivery === "promise")
      yield { ...s, nodes: replace(s.nodes, i, { ...s.nodes[i], delivery: "manual" }) };
}
