import { queuedSteps, sourceIds, type Leaf, type Scenario, type Step } from "./scenario.js";

/** Alpha-renaming preserves creation/read/event order. Request inputs and
 * occurrence numbers are opaque: only their owning node's ID is renamed.
 * This runs during triage, never in the generated graph's hot path. */
export function normalize(s: Scenario): Scenario {
  const nodes = new Map<number, number>();
  const readers = new Map<number, number>();
  const actions = new Map<number, number>();
  const callbacks = new Map<number, number>();
  for (let i = 0; i < s.nodes.length; i++) nodes.set(s.nodes[i].id, i);
  for (let i = 0; i < s.readers.length; i++) readers.set(s.readers[i].id, i);
  for (let i = 0; i < (s.actions?.length ?? 0); i++) actions.set(s.actions![i].id, i);
  for (const turn of s.turns)
    if ("steps" in turn)
      for (const step of turn.steps)
        if (step.op === "queue") callbacks.set(step.id, callbacks.size);
  // Negative source IDs have distinguished roles (-1 truth, -2 optimistic).
  // Keep them fixed; graph ordering must not exchange those roles.
  const ref = (id: number) => (id < 0 ? id : nodes.get(id)!);
  const refs = (ids: number[]) => {
    const result: number[] = [];
    for (const id of ids) result.push(ref(id));
    return result;
  };
  const request = (key: string): string => {
    const colon = key.indexOf(":");
    const id = Number(key.slice(0, colon));
    // Preserve malformed keys rather than making an invalid replay runnable.
    return colon > 0 && String(id) === key.slice(0, colon) && nodes.has(id)
      ? `${ref(id)}${key.slice(colon)}`
      : key;
  };
  const requestKeys = (keys: Array<string | null> | undefined) => {
    if (!keys) return undefined;
    const result: Array<string | null> = [];
    for (const key of keys) result.push(key === null ? null : request(key));
    return result;
  };
  const leaf = (x: Leaf): Leaf => {
    switch (x.op) {
      case "write":
        return { op: x.op, source: x.source ?? -1, value: x.value };
      case "show":
        return { op: x.op, value: x.value };
      case "resolve":
        return {
          op: x.op,
          node: ref(x.node),
          which: x.key ? "newest" : x.which,
          key: x.key === undefined ? undefined : request(x.key),
          variantKeys: requestKeys(x.variantKeys)
        };
      case "read":
        return { op: x.op, ref: ref(x.ref), mode: x.mode };
      case "mount":
        return { op: x.op, reader: readers.get(x.reader)!, value: x.value };
      case "dispose":
      case "click":
        return { op: x.op, reader: readers.get(x.reader)! };
      case "start-action":
      case "resume-action":
        return { op: x.op, action: x.action === undefined ? undefined : actions.get(x.action)! };
      default:
        return { op: x.op };
    }
  };
  const step = (x: Step): Step => {
    if (x.op === "cancel") return { op: x.op, id: callbacks.get(x.id)! };
    if (x.op !== "queue") return leaf(x);
    const steps: Leaf[] = [];
    for (const item of queuedSteps(x)) steps.push(leaf(item));
    return { op: x.op, id: callbacks.get(x.id)!, via: x.via, steps };
  };
  const renamedNodes: Scenario["nodes"] = [];
  for (const n of s.nodes)
    renamedNodes.push({
      id: ref(n.id),
      deps: refs(n.deps),
      factor: n.factor,
      offset: n.offset,
      delivery: n.delivery,
      branch: n.branch && {
        condition: ref(n.branch.condition),
        otherwise: refs(n.branch.otherwise)
      }
    });
  const renamedReaders: Scenario["readers"] = [];
  for (const r of s.readers)
    renamedReaders.push({
      id: readers.get(r.id)!,
      refs: refs(r.refs),
      gated: r.gated,
      boundary: r.boundary,
      parent: r.parent === undefined ? undefined : readers.get(r.parent),
      mounted: r.mounted,
      pending: r.pending,
      pendingDepth: r.pendingDepth,
      render: r.render && {
        on: ref(r.render.on),
        target: r.render.target,
        scheduled: r.render.scheduled
      }
    });
  let renamedActions: Scenario["actions"];
  if (s.actions) {
    renamedActions = [];
    for (const a of s.actions)
      renamedActions.push({ id: actions.get(a.id)!, segments: a.segments });
  }
  const turns: Scenario["turns"] = [];
  for (const t of s.turns) {
    if ("task" in t) turns.push({ task: callbacks.get(t.task)! });
    else {
      const steps: Step[] = [];
      for (const x of t.steps) steps.push(step(x));
      turns.push({ steps });
    }
  }
  let anchors = s.anchors;
  const sources = sourceIds(s);
  if (anchors && anchors.length === sources.length) {
    let same = true;
    for (let i = 0; i < anchors.length; i++) if (anchors[i] !== sources[i]) same = false;
    if (same) anchors = undefined;
  }
  return {
    version: s.version,
    sources: s.sources,
    anchors,
    anchorShow: s.anchorShow === false ? false : undefined,
    optimistic: s.optimistic && {
      kind: s.optimistic.kind,
      proposals: s.optimistic.proposals,
      authoritative: s.optimistic.authoritative,
      hold: s.optimistic.hold,
      viaMemo: s.optimistic.viaMemo
    },
    actions: renamedActions,
    warmLatest: s.warmLatest?.length ? refs(s.warmLatest) : undefined,
    nodes: renamedNodes,
    readers: renamedReaders,
    show: s.show,
    turns,
    strict: s.strict
  };
}

/** Exact normalized execution, not a graph-isomorphism or symptom hash. */
export function scenarioKey(s: Scenario): string {
  return JSON.stringify(normalize(s));
}
