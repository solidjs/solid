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
 * back. The fill commit performs NO DOM writes: primitive rows ADOPT the
 * server's text nodes (a claim, not a mutation), and a server/client
 * mismatch is DETECTED (one dev warning) but not recovered — classic's
 * claim pass leaves the server DOM as sent, and so does the engine.
 */
import { sharedConfig } from "./hydration.js";
import { IS_DEV } from "./core.js";
import { installSlotHydration, type FlatPlan, type Slot, type SlotNode } from "./for-slot.js";

const hooks = {
  engage(
    meta: any,
    marker: SlotNode | null | undefined,
    region: SlotNode[] | undefined
  ): { id: string } | false {
    if (!sharedConfig.hydrating) return false;
    // Whole-parent (marker undefined) and comment-bounded holes (the
    // compiled hydrating client resolves anchored holes to the `<!--/-->`
    // marker NODE via getNextMarker, with the region as `initial`) hydrate.
    // Without a parity id or a region there is nothing to claim against
    // (a `null` marker never occurs under hydration): fill as a CSR list.
    if (marker === null || meta.hid === undefined || region === undefined) return false;
    return { id: meta.hid };
  },

  commitFill(slot: Slot, fp: FlatPlan): void {
    slot.hyd = false;
    // This module IS the web hydration binding: nodes are DOM nodes here.
    const parent = slot.parent as Node;
    const region = slot.region as Node[];
    const nodes = fp.nodes as (Node | Node[] | null)[];
    // Primitive rows: ADOPT the positional server text node (classic's
    // normalizeIncomingArray rule) — zero-write hydration and node identity
    // for text rows (pre-hydration edits/selection survive). Rows and region
    // walk in lockstep, skipping the server's separator comments; the walk
    // stops at the first misaligned element (a mismatch — detected below).
    let cursor = 0;
    adopt: for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if (nd === null) continue; // zero-node row
      const arr = Array.isArray(nd) ? nd : null;
      const n = arr !== null ? arr.length : 1;
      for (let k = 0; k < n; k++) {
        const c = arr !== null ? arr[k] : (nd as Node);
        let s = region[cursor];
        while (s !== undefined && s.nodeType === 8) s = region[++cursor];
        if (s === undefined) break adopt;
        cursor++;
        if (s === c) continue;
        if (c.nodeType !== 3 || s.nodeType !== 3 || c.parentNode === parent) break adopt;
        if ((s as Text).data !== (c as Text).data) (s as Text).data = (c as Text).data;
        if (arr !== null) arr[k] = s;
        else nodes[i] = s;
      }
    }
    // MISMATCH: detect, don't recover (ruling 2026-09-07). Classic's claim
    // pass leaves unclaimed server rows in place and never inserts a row
    // whose template key-missed (it lands on the next update); the engine
    // does the same. The runtime already reports unclaimed ELEMENTS and
    // key-missed templates at hydration end; the one blind spot is TEXT rows
    // (never in the registry), so detection here covers exactly those.
    if (IS_DEV) {
      const ours = new Set<Node>();
      let detached = 0;
      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i];
        if (nd === null) continue;
        if (Array.isArray(nd))
          for (const n of nd) {
            ours.add(n);
            if (n.nodeType === 3 && n.parentNode !== parent) detached++;
          }
        else {
          ours.add(nd);
          if (nd.nodeType === 3 && nd.parentNode !== parent) detached++;
        }
      }
      let leftover = 0;
      for (let i = 0; i < region.length; i++)
        if (region[i].nodeType === 3 && !ours.has(region[i])) leftover++;
      if (leftover !== 0 || detached !== 0)
        console.warn(
          `Hydration mismatch in <For>: the server rendered a different list than the client ` +
            `(${leftover} server text row(s) unclaimed, ${detached} client text row(s) not in the DOM). ` +
            `Server and client should render the same list; the DOM was left as the server sent it.`
        );
    }
    slot.region = undefined;
    slot.flat = {
      items: fp.items,
      owners: fp.owners,
      nodes: fp.nodes,
      fns: fp.fns,
      ixs: fp.ixs,
      its: fp.its
    };
    slot.size = fp.len;
  }
};

/** Called by enableHydration(). */
export function installForSlotHydration(): void {
  installSlotHydration(hooks);
}
