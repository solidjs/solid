/**
 * Unified For — the NODE LAYER for the list engine's RENDERED output.
 *
 * The engine (`@solidjs/signals` list.ts) owns row bookkeeping in every For
 * mode and never touches a node: it calls back into a `ListNodeLayer`. This
 * module builds that layer over a renderer's `SlotOps` — web hands in
 * `domOps`, `@solidjs/universal` hands in ops built from its `createRenderer`
 * primitives — and wires the engine to a two-phase render effect (compute
 * diffs and builds detached rows; the effect places). Nothing here is DOM:
 * every node touch rides the ops, so one node layer serves both renderers.
 *
 * DELIVERY (module-graph, no registration): `For` stamps `$for.impl` with
 * `unifiedForSlot`; a renderer's insert() engages it with ITS ops. Apps whose
 * lists are never rendered (children()/introspection only) never load this
 * module — a plain call of the For accessor is the engine's ARRAY output.
 *
 * DYNAMIC ROWS (classic's list-effect model): a row whose top level resolves
 * to a FUNCTION is created once and RESOLVED by the engine's compute,
 * tracked — the `flatten` read classic's insert effect performs for such
 * rows. `build()` reports the function; `resolve()`/`same()`/`splice()`
 * carry the per-run diff and the commit-time range splice (text nodes
 * reused with a data write).
 */
import {
  createListEngine,
  createRenderEffect,
  firstNodeOf,
  flatten,
  lastNodeOf,
  onCleanup,
  runWithOwner,
  type ListFlatPlan,
  type ListLeaves,
  type ListMeta,
  type ListNode,
  type ListNodeLayer,
  type ListNodes,
  type ListSlot
} from "@solidjs/signals";
import { IS_DEV } from "./core.js";

export type SlotNode = ListNode;
export type Slot = ListSlot;
export type FlatPlan = ListFlatPlan;

/** RENDERER OPS — the node layer's entire platform surface. A renderer's
 * insert() hands ONE module-level singleton (web: `domOps`), so every call
 * site stays monomorphic. */
export interface SlotOps {
  insert(parent: SlotNode, node: SlotNode, anchor: SlotNode | null): void;
  remove(node: SlotNode): void;
  createText(text: string): SlotNode;
  isNode(v: unknown): boolean;
  /** Whole-parent bulk clear (batch-clear / full-replace fast paths). */
  clear(parent: SlotNode): void;
  /** Ownership marker for multi-slot parents (web: `$$SLOT`). */
  tag(node: SlotNode, marker: SlotNode): void;
  /** True when `node` is a direct child of `parent` (ownership guard). */
  contains(parent: SlotNode, node: SlotNode): boolean;
  /** True when `first`/`last` are the parent's first/last children. */
  owns(parent: SlotNode, first: SlotNode, last: SlotNode): boolean;
  /** Next sibling (list-end anchor: classic's contiguity rule). */
  next(node: SlotNode): SlotNode | null;
  /** Text node data, or undefined for non-text nodes (dynamic-row diff). */
  textOf(node: SlotNode): string | undefined;
  /** Write text data if `node` is a text node; false otherwise (commit). */
  setText(node: SlotNode, text: string): boolean;
}

/** HYDRATION HOOKS — installed by enableHydration() (for-slot-hydration.ts),
 * null in CSR bundles so every hydration path folds away. */
export interface SlotHydration {
  /** Engage-time decision: `false` = not hydrating; `{ id }` = hydrating
   * fill with the parity owner id. */
  engage(
    meta: any,
    marker: SlotNode | null | undefined,
    region: SlotNode[] | undefined
  ): { id: string } | false;
  /** Hydrating fill commit: reconcile claimed rows against the region. */
  commitFill(slot: Slot, fp: FlatPlan): void;
}
let slotHydration: SlotHydration | null = null;
export function installSlotHydration(h: SlotHydration): void {
  slotHydration = h;
}

// The two-phase render effect in web's `effect()` shape: transparent + sync.
const transparentOptions = { transparent: true, sync: true } as const;

const FLATTEN_OPTS = { skipNonRendered: true, doNotUnwrap: true } as const;
const RESOLVE_OPTS = { skipNonRendered: true } as const;
const EMPTY: ListLeaves = [];
const toLeaves = (v: any): ListLeaves => (v === undefined ? EMPTY : Array.isArray(v) ? v : [v]);

/** Materialize leaves as DETACHED nodes; none → null (zero-node row). */
function leavesToNodes(leaves: ListLeaves, ops: SlotOps): ListNodes {
  const n = leaves.length;
  if (n === 0) return null;
  if (n === 1) {
    const c = leaves[0];
    return ops.isNode(c) ? (c as SlotNode) : ops.createText(String(c));
  }
  const ns: SlotNode[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = leaves[i];
    ns[i] = ops.isNode(c) ? (c as SlotNode) : ops.createText(String(c));
  }
  return ns;
}

/** Detach only what is still OURS (classic's `parentNode === parent` guard). */
function detachOne(slot: Slot, ops: SlotOps, n: SlotNode): void {
  if (ops.contains(slot.parent!, n)) ops.remove(n);
}

/** Node layers are per renderer ops singleton — cached so every list on a
 * renderer shares one layer object (monomorphic call sites). */
const layers = new WeakMap<SlotOps, ListNodeLayer>();

/** Build the ListNodeLayer over a renderer's ops. */
export function nodeLayer(ops: SlotOps): ListNodeLayer {
  let layer = layers.get(ops);
  if (layer !== undefined) return layer;
  let dyn: any = null;
  layer = {
    build(v, o) {
      dyn = null;
      if (ops.isNode(v)) return v as SlotNode;
      const t = typeof v;
      if (t === "string" || t === "number") return ops.createText(String(v));
      if (t === "function") {
        dyn = v; // dynamic: resolved tracked by the engine
        return null;
      }
      // Fragments / nested arrays: flatten owned, leaving accessor leaves
      // unresolved — a resolving wrapper comes back when there are any, and
      // the row is dynamic; otherwise the leaves are static.
      v = runWithOwner(o as any, () => flatten(v, FLATTEN_OPTS));
      if (typeof v === "function") {
        dyn = v;
        return null;
      }
      return leavesToNodes(toLeaves(v), ops);
    },
    dynamic: () => dyn,
    resolve: f => toLeaves(flatten(f, RESOLVE_OPTS)),
    toNodes: leaves => leavesToNodes(leaves, ops),
    same(leaves, cur) {
      const n = leaves.length;
      if (cur === null) return n === 0;
      const arr = Array.isArray(cur) ? cur : null;
      if (n !== (arr !== null ? arr.length : 1)) return false;
      for (let i = 0; i < n; i++) {
        const c = arr !== null ? arr[i] : (cur as SlotNode);
        const l = leaves[i];
        if (ops.isNode(l)) {
          if (l !== c) return false;
        } else if (ops.textOf(c) !== String(l)) return false;
      }
      return true;
    },
    splice(slot, cur, leaves, anchor) {
      // Reuse positional text nodes with a data write, detach what didn't
      // survive (guarded), place the new range before `anchor`.
      const parent = slot.parent!;
      const arr: SlotNode[] = cur === null ? [] : Array.isArray(cur) ? cur : [cur];
      const n = leaves.length;
      const out: SlotNode[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const l = leaves[i];
        if (ops.isNode(l)) out[i] = l as SlotNode;
        else {
          const s = String(l);
          const c = arr[i];
          out[i] = c !== undefined && ops.setText(c, s) ? c : ops.createText(s);
        }
      }
      for (let i = 0; i < arr.length; i++)
        if (out.indexOf(arr[i]) === -1) detachOne(slot, ops, arr[i]);
      const tag = slot.end;
      for (let i = n - 1; i >= 0; i--) {
        ops.insert(parent, out[i], anchor);
        if (tag) ops.tag(out[i], tag);
        anchor = out[i];
      }
      return n === 0 ? null : n === 1 ? out[0] : out;
    },
    place(slot, nd, anchor, tagIt) {
      if (nd === null) return;
      const tag = slot.end;
      const parent = slot.parent!;
      if (Array.isArray(nd)) {
        for (let i = 0; i < nd.length; i++) {
          ops.insert(parent, nd[i], anchor);
          if (tag && tagIt) ops.tag(nd[i], tag);
        }
      } else {
        ops.insert(parent, nd, anchor);
        if (tag && tagIt) ops.tag(nd, tag);
      }
    },
    detach(slot, nd) {
      if (nd === null) return;
      if (Array.isArray(nd)) for (let i = 0; i < nd.length; i++) detachOne(slot, ops, nd[i]);
      else detachOne(slot, ops, nd);
    },
    endAnchor(slot) {
      // The node AFTER the list — classic's contiguity rule (`tail.nextSibling`
      // while the tail is still ours); else the end marker / parent end.
      const last = lastNodeOf(slot);
      return last !== null && ops.contains(slot.parent!, last) ? ops.next(last) : slot.end;
    },
    ownsParent(slot) {
      // Whole-parent bulk ops are safe only when our window IS the parent's
      // entire child list — classic's ownsAllChildren ruling.
      if (!slot.whole || slot.fb !== null) return false;
      const first = firstNodeOf(slot);
      const last = lastNodeOf(slot);
      return first !== null && last !== null && ops.owns(slot.parent!, first, last);
    },
    clear(slot) {
      if (IS_DEV) __unifiedForStats.batchCleared++;
      ops.clear(slot.parent!);
    },
    inParent: (slot, node) => ops.contains(slot.parent!, node),
    commitFill: null
  };
  layers.set(ops, layer);
  return layer;
}

/** Rendered output — For stamps this as `$for.impl`; a renderer's insert()
 * engages it with its SlotOps. */
export function unifiedForSlot(
  parent: SlotNode,
  listFn: any,
  marker: SlotNode | null | undefined,
  ops: SlotOps,
  region?: SlotNode[],
  /** HOLE mode: engaged from inside a wrapper insert's compute (the
   * `{props.children}` seam). The hosting effect owns the hole, so the
   * engine removes its rows on cleanup (a children change or dispose) — in
   * direct mode the parent element's removal covers that for free. */
  hole = false
): void {
  const meta: ListMeta = listFn.$for;
  // HYDRATION: decided by the installed hooks (null in CSR bundles). A
  // hydrating engage hands back the parity owner id so the engine's rows
  // mint the same hydration keys the server's did.
  let ownerOpts: { id: string } | undefined;
  let hyd = false;
  let layer = nodeLayer(ops);
  if (slotHydration !== null) {
    const h = slotHydration.engage(meta, marker, region);
    if (h !== false) {
      ownerOpts = h;
      hyd = true;
      // A hydrating list commits its first fill as a claim pass.
      layer = { ...layer, commitFill: slotHydration.commitFill };
    }
  }
  const e = createListEngine(meta, parent, marker, layer, region, hole, ownerOpts, hyd);
  if (IS_DEV) __unifiedForStats.engaged++;
  onCleanup(e.teardown);
  createRenderEffect(e.compute, e.commit, transparentOptions);
}

/** DEV-ONLY probes: engagement / bulk-clear counters, exposed as `DEV.unifiedFor`. */
export interface UnifiedForStats {
  engaged: number;
  batchCleared: number;
}
export const __unifiedForStats: UnifiedForStats = { engaged: 0, batchCleared: 0 };
