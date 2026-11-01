import { anchorIds, sourceIds, type Scenario } from "./scenario.js";

interface Node {
  slot: number;
  deps: number[];
  condition: number;
  otherwise: number[];
  factor: number;
  offset: number;
}

/** An independently owned evaluation of the pure specification. Slots are dense
 * even when shrinking leaves holes in the replay's stable node IDs. */
export class Values {
  readonly data: number[] = [];
  constructor(
    private model: Model,
    input: number,
    inputs?: Record<number, number>
  ) {
    for (const id of model.sources) this.data.push(inputs?.[id] ?? (id === -1 ? input : 0));
    for (const node of model.nodes) {
      const deps = node.condition < 0 || this.data[node.condition] ? node.deps : node.otherwise;
      let sum = 0;
      for (const dep of deps) sum += this.data[dep];
      this.data.push(sum * node.factor + node.offset);
    }
  }
  get(ref: number): number {
    return this.data[this.model.slots.get(ref)!];
  }
  inputs(nodeIndex: number): number[] {
    const node = this.model.nodes[nodeIndex];
    const deps = node.condition < 0 || this.data[node.condition] ? node.deps : node.otherwise;
    const inputs: number[] = [];
    if (node.condition >= 0) inputs.push(this.data[node.condition]);
    for (const dep of deps) inputs.push(this.data[dep]);
    return inputs;
  }
}

/** Compile graph shape once per case. Four source bits fit in a small integer;
 * values remain ordinary small numbers, with no provenance wrappers. This is
 * pure scenario metadata, never a model of Solid's lane or pending internals. */
export class Model {
  readonly sources: number[];
  readonly anchors: number[];
  readonly slots = new Map<number, number>();
  readonly nodes: Node[] = [];
  readonly masks: number[] = [];
  readonly tupleMasks = new Map<number, number>();
  readonly size: number;
  readonly anchorMask: number;
  readonly hasPending: boolean;
  readonly latestMask: number;
  constructor(s: Scenario) {
    this.sources = sourceIds(s);
    this.anchors = anchorIds(s);
    let anchorMask = 0;
    for (let i = 0; i < this.sources.length; i++) {
      const id = this.sources[i];
      this.slots.set(id, i);
      this.masks.push(1 << i);
      if (this.anchors.includes(id)) anchorMask |= 1 << i;
    }
    this.anchorMask = anchorMask;
    for (const spec of s.nodes) {
      const slot = this.slots.size;
      const deps: number[] = [];
      for (const id of spec.deps) deps.push(this.slots.get(id)!);
      const otherwise: number[] = spec.branch ? [] : deps;
      if (spec.branch) for (const id of spec.branch.otherwise) otherwise.push(this.slots.get(id)!);
      const condition = spec.branch ? this.slots.get(spec.branch.condition)! : -1;
      let mask = condition < 0 ? 0 : this.masks[condition];
      for (const dep of deps) mask |= this.masks[dep];
      if (spec.branch) for (const dep of otherwise) mask |= this.masks[dep];
      this.masks.push(mask);
      this.nodes.push({
        slot,
        deps,
        otherwise,
        condition,
        factor: spec.factor,
        offset: spec.offset
      });
      this.slots.set(spec.id, slot);
    }
    for (const reader of s.readers) {
      let mask = 0;
      for (const ref of reader.refs) if (ref < 0) mask |= this.sourceMask(ref);
      this.tupleMasks.set(reader.id, mask);
    }
    this.size = this.slots.size;
    this.latestMask = s.optimistic?.kind === "latest" ? this.sourceMask(-2) : 0;
    this.hasPending =
      !s.optimistic &&
      s.readers.some(
        r => r.pending && !r.gated && r.mounted === undefined && r.boundary === "none"
      );
  }
  evaluate(input: number, inputs?: Record<number, number>): Values {
    return new Values(this, input, inputs);
  }
  sourceMask(ref: number): number {
    return this.masks[this.slots.get(ref)!];
  }
  readsLatest(ref: number): boolean {
    return (this.sourceMask(ref) & this.latestMask) !== 0;
  }
  witnessed(ref: number, mask = this.anchorMask): boolean {
    const sources = this.sourceMask(ref);
    return (sources & mask) === sources;
  }
  select(refs: number[], values: Values, count = refs.length): Uint8Array {
    const needed = new Uint8Array(this.size);
    for (let i = 0; i < count; i++) needed[this.slots.get(refs[i])!] = 1;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (!needed[node.slot]) continue;
      let deps = node.deps;
      if (node.condition >= 0) {
        needed[node.condition] = 1;
        if (!values.data[node.condition]) deps = node.otherwise;
      }
      for (let j = 0; j < deps.length; j++) needed[deps[j]] = 1;
    }
    return needed;
  }
}

export function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
