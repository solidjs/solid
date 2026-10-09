import type { Model } from "./model.js";
import { queuedSteps, type Scenario, type ReaderSpec } from "./scenario.js";
import type { Failure, Frame } from "./rules.js";
import type { Requirement } from "./runner.js";

interface Group {
  id: number;
  root: number;
  mask: number;
  holds: number;
  before: number[];
  target: number[];
  adjacent: number[];
  published: boolean;
  visit: number;
  notedMask: number;
}

/** Ordinary, initialized flat graphs first. Skipping this stronger contract
 * does not disable the existing consistency or whole-view progress checks. */
export function groupScope(s: Scenario, model: Model): string | undefined {
  if (s.readers.some(r => r.render)) return "output-attachment";
  if (s.warmLatest?.length) return "latest-read";
  for (const turn of s.turns)
    if ("steps" in turn)
      for (const step of turn.steps)
        for (const leaf of step.op === "queue" ? queuedSteps(step) : [step]) {
          if (leaf.op === "show" || leaf.op === "mount" || leaf.op === "dispose")
            return "changing-observation";
          if (leaf.op === "read" && leaf.mode === "latest") return "latest-read";
        }
  if (s.optimistic) return "optimistic-lifetime";
  if (s.nodes.some(n => n.branch)) return "branch-history";
  if (
    s.readers.some(
      r =>
        r.gated ||
        r.mounted !== undefined ||
        r.parent !== undefined ||
        r.pending ||
        r.boundary !== "none"
    )
  )
    return "changing-observation";
  if (model.anchorMask !== (1 << model.sources.length) - 1) return "partial-anchors";
}

/** Update identity comes from executed input, not runtime transition IDs.
 * One callback is a proven batch; explicit flush closes it synchronously.
 * Activity in the same host task and its microtask drain may entangle, but
 * neither that permission nor possible memo joins ever assert atomicity. */
export class Groups {
  private groups: Group[] = [];
  private live: number[] = [];
  private owners: number[];
  private batch = -1;
  private window: number[] = [];
  private visit = 0;
  private closureHeld = false;
  private demandMasks = new Map<number, number[]>();
  private actionGroups = new Map<number, number>();
  readonly events: string[] = [];
  checks = 0;
  held = 0;
  possibleJoins = 0;
  batchingHeld = 0;
  constructor(
    private model: Model,
    readers: ReaderSpec[]
  ) {
    this.owners = model.sources.map(() => -1);
    // A changed derivation may need async ancestors driven by other sources.
    // Seed EACH declared ref separately so sharing an effect never connects its
    // independent refs. Propagate the demand only through memo dependency edges.
    for (const reader of readers) {
      const demands = new Array<number>(model.size).fill(0);
      for (const ref of reader.refs) {
        const slot = model.slots.get(ref)!;
        demands[slot] |= model.masks[slot];
      }
      for (let i = model.nodes.length - 1; i >= 0; i--) {
        const node = model.nodes[i];
        for (const dep of node.deps) demands[dep] |= demands[node.slot];
      }
      this.demandMasks.set(reader.id, demands);
    }
  }
  get pending(): boolean {
    return this.live.length > 0;
  }
  private root(id: number): number {
    while (this.groups[id].root !== id) id = this.groups[id].root;
    return id;
  }
  private current(frame: Frame, i: number): number {
    return frame.inputs?.[this.model.sources[i]] ?? frame.input;
  }
  private create(frame: Frame): number {
    const before = this.model.sources.map((_, i) => this.current(frame, i));
    const id = this.groups.length;
    this.groups.push({
      id,
      root: id,
      mask: 0,
      holds: 0,
      before,
      target: before.slice(),
      adjacent: [],
      published: false,
      visit: 0,
      notedMask: -1
    });
    this.live.push(id);
    this.events.push(`group ${id} starts`);
    return id;
  }
  private batchGroup(frame: Frame): number {
    if (this.batch === -1) this.batch = this.create(frame);
    return this.root(this.batch);
  }
  private merge(a: number, b: number, why: string): number {
    a = this.root(a);
    b = this.root(b);
    if (a === b) return a;
    // Keep older history as the root, including its pre-update published values.
    if (a > b) [a, b] = [b, a];
    const x = this.groups[a],
      y = this.groups[b];
    for (let i = 0; i < this.owners.length; i++)
      if (y.mask & (1 << i)) {
        if (!(x.mask & (1 << i))) x.before[i] = y.before[i];
        x.target[i] = y.target[i];
      }
    x.mask |= y.mask;
    x.holds += y.holds;
    for (const other of y.adjacent) if (!x.adjacent.includes(other)) x.adjacent.push(other);
    y.root = a;
    this.live.splice(this.live.indexOf(b), 1);
    this.events.push(`group ${b} joins ${a}: ${why}`);
    return a;
  }
  write(source: number, value: number, frame: Frame, action?: number): void {
    const slot = this.model.slots.get(source)!;
    let id =
      action === undefined ? this.batchGroup(frame) : this.root(this.actionGroups.get(action)!);
    const owner = this.owners[slot];
    if (owner !== -1) id = this.merge(id, owner, "same source");
    const group = this.groups[id];
    if (!(group.mask & (1 << slot))) group.before[slot] = this.current(frame, slot);
    group.mask |= 1 << slot;
    group.target[slot] = value;
    this.owners[slot] = id;
    this.touch(id);
  }
  startAction(action: number, frame: Frame): void {
    const id = this.batchGroup(frame);
    this.groups[id].holds++;
    this.actionGroups.set(action, id);
    this.touch(id);
    this.events.push(`action ${action} holds group ${id}`);
  }
  finishAction(action: number): void {
    const id = this.root(this.actionGroups.get(action)!);
    this.groups[id].holds--;
    this.events.push(`action ${action} releases group ${id}`);
  }
  /** A real host-task boundary ends temporal proximity, not existing edges. */
  beginTask(): void {
    this.closeBatch();
    this.window.length = 0;
  }
  closeBatch(): void {
    this.batch = -1;
  }
  /** Explicit user flush is a deliberate separator, even within one callback. */
  separator(): void {
    this.beginTask();
  }
  resumeAction(action: number): void {
    this.closeBatch();
    this.touch(this.root(this.actionGroups.get(action)!));
  }
  /** Only generated memo identities/source masks are used, never Solid's owner IDs. */
  landing(mask: number): void {
    this.closeBatch();
    for (const id of this.live) if (this.groups[id].mask & mask) this.touch(id);
  }
  private touch(id: number): void {
    id = this.root(id);
    const group = this.groups[id];
    let present = false;
    for (const previous of this.window) {
      const other = this.root(previous);
      if (other === id) {
        present = true;
        continue;
      }
      const peer = this.groups[other];
      if (peer.published || group.adjacent.includes(other)) continue;
      group.adjacent.push(other);
      peer.adjacent.push(id);
      this.events.push(`groups ${id} and ${other} may join: adjacent microtasks`);
    }
    if (!present) this.window.push(id);
  }
  /** Run only at complete publication checkpoints, never between effect runners. */
  publication(frame: Frame): Failure | undefined {
    for (let j = this.live.length - 1; j >= 0; j--) {
      const group = this.groups[this.live[j]];
      let changed = false,
        complete = true;
      for (let i = 0; i < this.owners.length; i++) {
        if (!(group.mask & (1 << i))) continue;
        const value = this.current(frame, i);
        if (value !== group.before[i]) changed = true;
        if (value !== group.target[i]) complete = false;
      }
      if (changed && (group.holds || !complete))
        return {
          rule: "G1",
          message: group.holds
            ? "Authoritative writes published while their action group is open"
            : "One proven update group published only part of its writes",
          frame,
          expected: {
            group: group.id,
            mask: group.mask,
            holds: group.holds,
            before: group.before.slice(),
            target: group.target.slice()
          }
        };
      if (complete && !group.holds) {
        group.published = true;
        for (let i = 0; i < this.owners.length; i++)
          if (this.owners[i] !== -1 && this.root(this.owners[i]) === group.id) this.owners[i] = -1;
        this.live.splice(j, 1);
        if (this.batch !== -1 && this.root(this.batch) === group.id) this.closeBatch();
        this.events.push(`group ${group.id} published`);
      }
    }
  }
  /** Close over shared memo ancestry and, optionally, temporal permissions.
   * Visit stamps avoid allocating a set for each group at each checkpoint. */
  private closure(id: number, adjacent: boolean): number {
    const visit = ++this.visit;
    this.groups[id].visit = visit;
    let mask = this.groups[id].mask;
    let changed: boolean;
    this.closureHeld = false;
    do {
      changed = false;
      for (const other of this.live) {
        const group = this.groups[other];
        if (group.visit !== visit) continue;
        if (group.holds) this.closureHeld = true;
        if (adjacent)
          for (const peer of group.adjacent) {
            const next = this.groups[this.root(peer)];
            if (next.published || next.visit === visit) continue;
            next.visit = visit;
            mask |= next.mask;
            changed = true;
          }
      }
      for (const node of this.model.nodes) {
        const deps = this.model.masks[node.slot];
        if (!(deps & mask)) continue;
        for (const other of this.live) {
          const group = this.groups[other];
          if (group.visit === visit || !(group.mask & deps)) continue;
          group.visit = visit;
          mask |= group.mask;
          changed = true;
        }
      }
    } while (changed);
    return mask;
  }
  private blocked(mask: number, requirements: Requirement[]): boolean {
    if (this.closureHeld) return true;
    for (const r of requirements)
      if (
        r.gate !== "resolved" &&
        this.demandMasks.get(r.reader)![this.model.slots.get(r.node)!] & mask
      )
        return true;
    return false;
  }
  /** Permissions extend deadlines only; publication still checks proven groups. */
  progress(frame: Frame, requirements: Requirement[]): Failure | undefined {
    for (const id of this.live) {
      const group = this.groups[id];
      this.checks++;
      if (!group.mask) continue;
      const baseMask = this.closure(id, false);
      if (baseMask !== group.mask) this.possibleJoins++;
      if (this.blocked(baseMask, requirements)) {
        this.held++;
        continue;
      }
      const mask = this.closure(id, true);
      if (this.blocked(mask, requirements)) {
        this.held++;
        this.batchingHeld++;
        if (group.notedMask !== mask) {
          group.notedMask = mask;
          this.events.push(`group ${id} deadline extended by adjacent microtasks: mask ${mask}`);
        }
        continue;
      }
      return {
        rule: "G2",
        message: "A ready update group remains unpublished",
        frame,
        expected: {
          group: id,
          mask: group.mask,
          possibleMask: mask,
          relation:
            mask !== baseMask
              ? "possible-batching"
              : mask !== group.mask
                ? "possible-entanglement"
                : this.live.length > 1
                  ? "independent"
                  : "single-group",
          target: group.target.slice()
        }
      };
    }
  }
}
