/**
 * Unified For — HYDRATION hooks (H2 v1). Installed by enableHydration(); CSR
 * bundles never import this module, so the slot's null-guarded hook calls
 * fold away (#2883's pay-for-hydration discipline).
 *
 * Contract: engage lists carrying an id-parity handle (`$for.hid`) and a
 * region snapshot — whole-parent holes (the parent's childNodes) and
 * comment-bounded holes (the hydrating client resolves anchored holes to
 * their `<!--/-->` end-marker node via getNextMarker, with the bounded
 * region as `initial`). Row templates then CLAIM server nodes
 * exactly as classic's would — the slot's row parent takes the SAME id
 * classic's mapArray owner spends, so rows mint identical hydration keys.
 * Nothing can demote mid-fill (see Slot.hyd), so claims are never handed
 * back. The fill commit mutates only on MISMATCH (leftover server rows
 * removed, key-missed fresh rows inserted); primitive rows ADOPT the
 * server's text nodes, so the normal case is zero DOM writes.
 */
import { sharedConfig } from "./hydration.js";
import { IS_DEV } from "./core.js";
import { installSlotHydration, type FlatPlan, type Slot, type SlotNode } from "./for-slot.js";

const hooks = {
  engage(
    meta: any,
    marker: SlotNode | null | undefined,
    region: SlotNode[] | undefined
  ): { id: string } | null | false {
    if (!sharedConfig.hydrating) return false;
    // Whole-parent (marker undefined) and comment-bounded holes (the
    // compiled hydrating client resolves anchored holes to the `<!--/-->`
    // marker NODE via getNextMarker, with the region as `initial`) both
    // engage. A `null` marker never occurs under hydration; decline it.
    if (marker === null || meta.hid === undefined || region === undefined) return null;
    return { id: meta.hid };
  },

  commitFill(slot: Slot, fp: FlatPlan): void {
    slot.hyd = false;
    const ops = slot.ops;
    // This module IS the web hydration binding: nodes are DOM nodes here.
    const parent = slot.parent as Node;
    const region = slot.region as Node[];
    const nodes = fp.nodes as (Node | Node[])[];
    // Primitive rows: ADOPT the positional server text node (classic's
    // normalizeIncomingArray rule) — zero-write hydration and node identity
    // for text rows (pre-hydration edits/selection survive). Rows and region
    // walk in lockstep, skipping the server's separator comments; the walk
    // stops at the first misaligned element (a mismatch — repaired below).
    let cursor = 0;
    adopt: for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      const arr = Array.isArray(nd) ? nd : null;
      const n = arr !== null ? arr.length : 1;
      for (let k = 0; k < n; k++) {
        const c = arr !== null ? arr[k] : (nd as Node);
        let s = region[cursor];
        while (s !== undefined && s.nodeType === 8) s = region[++cursor];
        if (s === undefined) break adopt;
        cursor++;
        if (s === c) continue;
        if (c.nodeType !== 3 || s.nodeType !== 3 || ops.contains(parent, c)) break adopt;
        if ((s as Text).data !== (c as Text).data) (s as Text).data = (c as Text).data;
        if (arr !== null) arr[k] = s;
        else nodes[i] = s;
      }
    }
    const ours = new Set<Node>();
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if (Array.isArray(nd)) for (const n of nd) ours.add(n);
      else ours.add(nd);
    }
    // Leftovers: server rows the client no longer has, separator comments.
    let removed = 0;
    let inserted = 0;
    for (let i = 0; i < region.length; i++)
      if (!ours.has(region[i]) && ops.contains(parent, region[i])) {
        ops.remove(region[i]);
        // Separator comments are not rows; text leftovers past the adoption
        // walk are (a shorter client list).
        if (region[i].nodeType !== 8) removed++;
      }
    // Fresh rows (template key-missed → detached; the runtime already
    // warned) are inserted at their position, back to front so anchors are
    // always attached. The list ends at the hole's end marker (or the
    // parent's end for whole-parent holes).
    let anchor: Node | null = slot.end as Node | null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const nd = nodes[i];
      if (Array.isArray(nd)) {
        for (let k = nd.length - 1; k >= 0; k--) {
          if (!ops.contains(parent, nd[k])) {
            ops.insert(parent, nd[k], anchor);
            inserted++;
          }
          anchor = nd[k];
        }
      } else {
        if (!ops.contains(parent, nd)) {
          ops.insert(parent, nd, anchor);
          inserted++;
        }
        anchor = nd;
      }
    }
    // The slot REPAIRS a server/client mismatch (classic's claim pass leaves
    // leftovers in place and reports them at hydration end); repairing
    // silently would hide the mismatch, so say so once, in dev.
    if (IS_DEV && (removed !== 0 || inserted !== 0))
      console.warn(
        `Hydration mismatch in <For>: the server rendered a different list than the client ` +
          `(${removed} unclaimed server row node(s) removed, ${inserted} client row node(s) inserted). ` +
          `The DOM was repaired, but server and client should render the same list.`
      );
    slot.region = undefined;
    slot.flat = { items: fp.items, owners: fp.owners, nodes: fp.nodes, fns: fp.fns };
    slot.size = fp.len;
  }
};

/** Called by enableHydration(). */
export function installForSlotHydration(): void {
  installSlotHydration(hooks);
}
