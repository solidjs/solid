/** The replay format is independent of fast-check and of Solid's node layout. */
export type Delivery = "sync" | "promise" | "manual" | "await";
export interface RenderSpec {
  on: number;
  target: "local" | "portal";
  // Local writes prepare fresh detached content. Portal writes always schedule.
  scheduled: boolean;
}
export interface MemoSpec {
  id: number;
  deps: number[]; // -1 is the numeric source; other references are stable memo IDs.
  factor: number;
  offset: number;
  delivery: Delivery;
  branch?: { condition: number; otherwise: number[] };
}
export interface ReaderSpec {
  id: number;
  refs: number[];
  gated: boolean;
  boundary: "none" | "retain" | "reset";
  parent?: number; // nested region inside an earlier reader's Loading content
  mounted?: boolean;
  pendingDepth?: number; // synchronous numeric derivations of the pending verdict
  pending?: boolean; // rendered isPending verdict instead of a data tuple
  render?: RenderSpec; // parent compute + nested host output effect
}
export type Leaf =
  | { op: "write"; value: number; source?: number }
  | { op: "show"; value: boolean }
  | {
      op: "resolve";
      node: number;
      which: "oldest" | "newest";
      key?: string;
      variantKeys?: Array<string | null>;
    }
  | { op: "dispose"; reader: number }
  | { op: "flush" }
  | { op: "start-action"; action?: number }
  | { op: "resume-action"; action?: number }
  | { op: "read"; ref: number; mode: "plain" | "latest" | "pending" }
  | { op: "click"; reader: number } // read the data guarded by a published ready verdict
  | { op: "mount"; reader: number; value: boolean }
  | { op: "noop" };
export type Step =
  | Leaf
  | ({
      op: "queue";
      id: number;
      via: "microtask" | "promise" | "await" | "task";
    } & ({ step: Leaf; steps?: never } | { steps: Leaf[]; step?: never }))
  | { op: "cancel"; id: number };
export type Turn = { steps: Step[] } | { task: number };
export interface ActionSpec {
  id: number;
  // Each segment executes synchronously in the action. A controlled yield
  // separates adjacent segments; the final segment finishes the action body.
  segments: Array<Array<{ source: number; value: number }>>;
}
export interface Scenario {
  version: 1 | 2;
  sources?: number[]; // v2: stable negative IDs, all initialized to zero; includes -1.
  anchors?: number[]; // sources whose published values have an explicit observing effect
  anchorShow?: boolean;
  optimistic?: {
    proposals: number[];
    authoritative: number;
    hold?: boolean;
    kind?: "override" | "latest";
    viaMemo?: boolean;
  }; // -1 truth, -2 optimistic view
  actions?: ActionSpec[];
  warmLatest?: number[];
  nodes: MemoSpec[];
  readers: ReaderSpec[];
  show: boolean;
  turns: Turn[];
  strict?: boolean; // Minimized/canonical resolves must keep their exact question.
}

export function validate(s: Scenario): string | undefined {
  // Replay files are external input. A malformed file is not a Solid failure.
  try {
    return validateShape(s);
  } catch {
    return "Invalid scenario format";
  }
}

function validateShape(s: Scenario): string | undefined {
  if (
    ![1, 2].includes(s.version) ||
    !Array.isArray(s.nodes) ||
    !Array.isArray(s.readers) ||
    !Array.isArray(s.turns)
  )
    return "Invalid scenario format";
  if (typeof s.show !== "boolean") return "Invalid initial observation";
  if (s.nodes.length > 32 || s.readers.length > 12 || s.turns.length > 100)
    return "Scenario size limit";
  const sources = sourceIds(s);
  if (
    (s.version === 1 && s.sources !== undefined) ||
    (s.version === 2 && !Array.isArray(s.sources)) ||
    sources.length > 4 ||
    !sources.includes(-1) ||
    new Set(sources).size !== sources.length ||
    sources.some(id => !Number.isInteger(id) || id >= 0)
  )
    return "Invalid sources";
  const refs = new Set(sources);
  if (
    s.anchors !== undefined &&
    (s.version !== 2 ||
      !Array.isArray(s.anchors) ||
      new Set(s.anchors).size !== s.anchors.length ||
      s.anchors.some(id => !sources.includes(id)))
  )
    return "Invalid publication anchors";
  if (s.anchorShow !== undefined && (s.version !== 2 || typeof s.anchorShow !== "boolean"))
    return "Invalid visibility anchor";
  for (const node of s.nodes) {
    if (
      !Number.isInteger(node.id) ||
      node.id < 0 ||
      refs.has(node.id) ||
      !Array.isArray(node.deps) ||
      !node.deps.length ||
      node.deps.length > 12 ||
      node.deps.some(id => !refs.has(id)) ||
      (node.branch !== undefined &&
        (s.version !== 2 ||
          !refs.has(node.branch.condition) ||
          !Array.isArray(node.branch.otherwise) ||
          !node.branch.otherwise.length ||
          node.branch.otherwise.length > 12 ||
          node.branch.otherwise.some(id => !refs.has(id)))) ||
      !Number.isFinite(node.factor) ||
      !Number.isFinite(node.offset) ||
      !["sync", "promise", "manual", "await"].includes(node.delivery)
    )
      return `Invalid memo ${node.id}`;
    refs.add(node.id);
  }
  const readers = new Set<number>();
  let boundaries = 0;
  for (const r of s.readers) {
    if (
      !Number.isInteger(r.id) ||
      r.id < 0 ||
      typeof r.gated !== "boolean" ||
      (r.mounted !== undefined && (typeof r.mounted !== "boolean" || s.version !== 2)) ||
      (r.pending !== undefined &&
        (typeof r.pending !== "boolean" || s.version !== 2 || s.optimistic?.kind === "latest")) ||
      (r.parent !== undefined &&
        (s.version !== 2 ||
          !readers.has(r.parent) ||
          s.readers.find(p => p.id === r.parent)!.boundary === "none")) ||
      (r.pendingDepth !== undefined &&
        (!r.pending ||
          !Number.isInteger(r.pendingDepth) ||
          r.pendingDepth < 1 ||
          r.pendingDepth > 3)) ||
      readers.has(r.id) ||
      !Array.isArray(r.refs) ||
      !r.refs.length ||
      r.refs.length > 12 ||
      r.refs.some(id => !refs.has(id)) ||
      !["none", "retain", "reset"].includes(r.boundary)
    )
      return `Invalid reader ${r.id}`;
    readers.add(r.id);
    if (r.render !== undefined) {
      if (
        s.version !== 2 ||
        s.optimistic ||
        s.actions ||
        s.warmLatest ||
        sources.length !== 1 ||
        s.nodes.some(n => n.branch) ||
        r.gated ||
        r.pending ||
        r.parent !== undefined ||
        r.mounted !== undefined ||
        r.boundary !== "none" ||
        !refs.has(r.render.on) ||
        !["local", "portal"].includes(r.render.target) ||
        typeof r.render.scheduled !== "boolean" ||
        (r.render.target === "portal" && !r.render.scheduled)
      )
        return "Output attachment currently requires ordinary fixed readers and scheduled portals";
      const needed = new Set(r.refs);
      for (let i = s.nodes.length - 1; i >= 0; i--)
        if (needed.has(s.nodes[i].id)) for (const dep of s.nodes[i].deps) needed.add(dep);
      if (!needed.has(r.render.on)) return "Output parent must be an ancestor of its payload";
    }
    if (r.boundary !== "none") boundaries++;
  }
  const nested = s.readers.some(r => r.parent !== undefined);
  if (nested && s.readers.some(r => r.render))
    return "Output attachment does not yet compose with nested boundaries";
  if (
    nested &&
    (s.optimistic || s.readers.some(r => r.gated || r.mounted !== undefined || r.pending))
  )
    return "Nested regions currently require static ordinary data readers";
  if (boundaries > 1 && s.version === 1) return "Multiple boundaries require version 2";
  if (
    boundaries &&
    s.nodes.some(n => n.branch) &&
    (nested || s.optimistic || s.readers.some(r => r.mounted !== undefined))
  )
    return "Branch/fallback history currently covers ordinary flat readers";
  if (
    s.warmLatest &&
    (!Array.isArray(s.warmLatest) ||
      s.warmLatest.length > 32 ||
      s.warmLatest.some(id => !refs.has(id)))
  )
    return "Invalid latest warmup";
  if (
    s.optimistic &&
    (s.version !== 2 ||
      sources.length !== 2 ||
      !sources.includes(-2) ||
      (s.optimistic.hold !== undefined && typeof s.optimistic.hold !== "boolean") ||
      (s.optimistic.kind !== undefined && !["override", "latest"].includes(s.optimistic.kind)) ||
      (s.optimistic.viaMemo !== undefined &&
        (s.optimistic.kind !== "latest" || typeof s.optimistic.viaMemo !== "boolean")) ||
      !Array.isArray(s.optimistic.proposals) ||
      !s.optimistic.proposals.length ||
      s.optimistic.proposals.length > 4 ||
      ![...s.optimistic.proposals, s.optimistic.authoritative].every(
        v => Number.isFinite(v) && Math.abs(v) <= 100
      ) ||
      (s.optimistic.kind !== "latest" &&
        s.readers.some(r => r.gated || r.boundary !== "none" || r.mounted !== undefined)))
  )
    return "Unsupported optimistic scenario";
  if (s.actions !== undefined) {
    if (
      s.version !== 2 ||
      s.optimistic ||
      !Array.isArray(s.actions) ||
      !s.actions.length ||
      s.actions.length > 2
    )
      return "Unsupported action scripts";
    const ids = new Set<number>();
    for (const script of s.actions) {
      if (
        !Number.isInteger(script.id) ||
        script.id < 0 ||
        ids.has(script.id) ||
        !Array.isArray(script.segments) ||
        script.segments.length < 2 ||
        script.segments.length > 5
      )
        return "Invalid action script";
      ids.add(script.id);
      for (const segment of script.segments)
        if (
          !Array.isArray(segment) ||
          segment.length > 4 ||
          segment.some(
            w => !sources.includes(w.source) || !Number.isFinite(w.value) || Math.abs(w.value) > 100
          )
        )
          return "Invalid action segment";
    }
  }
  const queued = new Set<number>();
  const leaf = (x: Leaf): boolean => {
    switch (x.op) {
      case "write":
        return (
          !s.optimistic &&
          sources.includes(x.source ?? -1) &&
          Number.isFinite(x.value) &&
          Math.abs(x.value) <= 100
        );
      case "show":
        return typeof x.value === "boolean";
      case "resolve":
        return (
          refs.has(x.node) &&
          x.node >= 0 &&
          ["oldest", "newest"].includes(x.which) &&
          (x.variantKeys === undefined ||
            (Array.isArray(x.variantKeys) &&
              x.variantKeys.length <= 3 &&
              x.variantKeys.every(k => k === null || typeof k === "string")))
        );
      case "dispose":
        return (
          !s.optimistic &&
          !nested &&
          readers.has(x.reader) &&
          s.readers.find(r => r.id === x.reader)?.mounted === undefined
        );
      case "mount":
        return (
          typeof x.value === "boolean" &&
          s.readers.some(r => r.id === x.reader && r.mounted !== undefined)
        );
      case "start-action":
      case "resume-action":
        return s.optimistic ? x.action === undefined : !!s.actions?.some(a => a.id === x.action);
      case "read":
        return refs.has(x.ref) && ["plain", "latest", "pending"].includes(x.mode);
      case "click":
        return s.readers.some(r => r.id === x.reader && r.pending);
      case "flush":
      case "noop":
        return true;
      default:
        return false;
    }
  };
  for (const turn of s.turns) {
    if ("task" in turn) {
      if (!queued.has(turn.task)) return "Unknown task";
    } else if (Array.isArray(turn.steps) && turn.steps.length <= 12) {
      for (const step of turn.steps) {
        if (step.op === "queue") {
          if (
            queued.has(step.id) ||
            (step.step !== undefined && step.steps !== undefined) ||
            !Array.isArray(queuedSteps(step)) ||
            queuedSteps(step).length > 12 ||
            !queuedSteps(step).every(leaf) ||
            !["task", "microtask", "promise", "await"].includes(step.via)
          )
            return "Invalid callback";
          queued.add(step.id);
        } else if (step.op === "cancel") {
          if (!queued.has(step.id)) return "Unknown callback";
        } else if (!leaf(step)) return "Invalid operation";
      }
    } else return "Invalid turn";
  }
}

/** Pure specification: no runtime accessors, flags, counters, or lane IDs. */
const defaultSources = [-1];
export function sourceIds(s: Scenario): number[] {
  return s.sources ?? defaultSources;
}

export function anchorIds(s: Scenario): number[] {
  return s.anchors ?? sourceIds(s);
}

export function queuedSteps(step: Extract<Step, { op: "queue" }>): Leaf[] {
  return step.steps ?? [step.step!];
}

export function evaluate(
  s: Scenario,
  input: number,
  inputs?: Record<number, number>
): Map<number, number> {
  const values = new Map<number, number>();
  for (const id of sourceIds(s)) values.set(id, inputs?.[id] ?? (id === -1 ? input : 0));
  for (const n of s.nodes) {
    const deps = !n.branch || values.get(n.branch.condition) ? n.deps : n.branch.otherwise;
    let sum = 0;
    for (const dep of deps) sum += values.get(dep)!;
    values.set(n.id, sum * n.factor + n.offset);
  }
  return values;
}

export function dependencies(n: MemoSpec, values?: Map<number, number>): number[] {
  if (!n.branch) return n.deps;
  return [
    n.branch.condition,
    ...(values
      ? values.get(n.branch.condition)
        ? n.deps
        : n.branch.otherwise
      : [...n.deps, ...n.branch.otherwise])
  ];
}

export function capture(n: MemoSpec, read: (id: number) => number): number[] {
  if (!n.branch) return n.deps.map(read);
  const condition = read(n.branch.condition);
  return [condition, ...(condition ? n.deps : n.branch.otherwise).map(read)];
}

export function answer(n: MemoSpec, inputs: number[]): number {
  let sum = 0;
  for (let i = n.branch ? 1 : 0; i < inputs.length; i++) sum += inputs[i];
  return sum * n.factor + n.offset;
}

export function ancestors(s: Scenario, refs: number[], values?: Map<number, number>): Set<number> {
  const needed = new Set(refs);
  for (let i = s.nodes.length - 1; i >= 0; i--) {
    const n = s.nodes[i];
    if (needed.has(n.id)) for (const dep of dependencies(n, values)) needed.add(dep);
  }
  return needed;
}
