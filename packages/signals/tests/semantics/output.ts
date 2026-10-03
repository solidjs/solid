import { createRenderEffect, onCleanup } from "../../src/index.js";
import type { Failure, Output } from "./rules.js";
import type { RenderSpec } from "./scenario.js";

interface Node {
  parent: number;
  first: number;
  last: number;
  previous: number;
  next: number;
  root: boolean;
  value?: Output;
}

/** Host attachment is independent of reactive ownership. One record per created
 * host node; disposal has no effect unless renderer cleanup actually detaches it. */
export class OutputTree {
  private nodes: Node[] = [];
  count = 0;
  privateWrites = 0;
  visibleWrites = 0;
  get size(): number {
    return this.nodes.length;
  }
  constructor(
    private limit: () => never = () => {
      throw new Error("Output node limit");
    }
  ) {}
  create(root = false): number {
    if (this.nodes.length === 4096) this.limit();
    const id = this.nodes.length;
    this.nodes.push({
      parent: -1,
      first: -1,
      last: -1,
      previous: -1,
      next: -1,
      root,
      value: undefined
    });
    return id;
  }
  visible(id: number): boolean {
    while (this.nodes[id].parent !== -1) id = this.nodes[id].parent;
    return this.nodes[id].root;
  }
  write(id: number, value: Output): void {
    if (this.visible(id)) this.visibleWrites++;
    else this.privateWrites++;
    this.nodes[id].value = value;
  }
  append(parent: number, id: number): void {
    // Bad renderer operations are harness errors, not semantic findings.
    for (let p = parent; p !== -1; p = this.nodes[p].parent)
      if (p === id) throw new Error("Cyclic host attachment");
    if (this.nodes[id].root) throw new Error("Cannot attach a visible root");
    this.detach(id);
    const node = this.nodes[id],
      target = this.nodes[parent];
    node.parent = parent;
    node.previous = target.last;
    if (target.last === -1) target.first = id;
    else this.nodes[target.last].next = id;
    target.last = id;
  }
  detach(id: number): void {
    const node = this.nodes[id];
    if (node.parent === -1) return;
    const parent = this.nodes[node.parent];
    if (node.previous === -1) parent.first = node.next;
    else this.nodes[node.previous].next = node.next;
    if (node.next === -1) parent.last = node.previous;
    else this.nodes[node.next].previous = node.previous;
    node.parent = node.previous = node.next = -1;
  }
  clear(id: number): void {
    while (this.nodes[id].first !== -1) this.detach(this.nodes[id].first);
  }
  replace(parent: number, id: number): void {
    this.clear(parent);
    this.append(parent, id);
  }
  /** Read the attached subtree without cloning it or consulting Solid state.
   * count exposes duplicate contributions instead of silently picking one. */
  read(root: number): Output {
    this.count = 0;
    let value: Output = "absent";
    if (!this.visible(root)) return value;
    let id = root;
    while (id !== -1) {
      const node = this.nodes[id];
      if (node.value !== undefined) {
        if (this.count++ === 0) value = node.value;
      }
      if (node.first !== -1) id = node.first;
      else {
        while (id !== root && this.nodes[id].next === -1) id = this.nodes[id].parent;
        id = id === root ? -1 : this.nodes[id].next;
      }
    }
    return value;
  }
}

export function checkAttachment(
  reader: number,
  count: number,
  initialized: boolean,
  active: boolean
): Failure | undefined {
  const message =
    !active && count
      ? "Removed region still has visible output"
      : active && count > 1
        ? "Region has duplicate visible output"
        : active && initialized && !count
          ? "Visible output disappeared before replacement or removal"
          : undefined;
  if (message)
    return { rule: "A1", message, reader, expected: { count: active ? 1 : 0, actual: count } };
}

/** A compiled-renderer shape: a parent compute creates private content, nested
 * effects populate it, and the parent's scheduled apply attaches it. A portal
 * instead attaches its payload to an independently visible destination. */
export function mountOutput(
  tree: OutputTree,
  root: number,
  spec: RenderSpec,
  readParent: () => number,
  read: () => Output
): void {
  const markerRoot = spec.target === "portal" ? tree.create(true) : root;
  createRenderEffect(
    () => {
      readParent();
      const container = tree.create();
      const text = tree.create();
      createRenderEffect(
        read,
        value => {
          tree.write(text, value);
          tree.append(spec.target === "portal" ? root : container, text);
          return () => tree.detach(text);
        },
        { schedule: spec.scheduled }
      );
      return container;
    },
    container => tree.replace(markerRoot, container),
    { schedule: true }
  );
  // Only explicit removal of the entire region authorizes this removal.
  onCleanup(() => {
    tree.clear(root);
    if (markerRoot !== root) tree.clear(markerRoot);
  });
}
