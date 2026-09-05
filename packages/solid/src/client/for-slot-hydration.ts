/**
 * Unified For — HYDRATION hooks (H2 v1). Installed by enableHydration(); CSR
 * bundles never import this module, so the slot's null-guarded hook calls
 * fold away (#2883's pay-for-hydration discipline).
 *
 * Contract: engage only whole-parent lists carrying an id-parity handle
 * (`$for.hid`) and a region snapshot. Row templates then CLAIM server nodes
 * exactly as classic's would — the slot's row parent takes the SAME id
 * classic's mapArray owner spends, so rows mint identical hydration keys.
 * Claims are RECORDED so a demote mid-fill hands them back: classic's re-run
 * mints the same ids and claims the same nodes (never a stranded claim).
 * The fill commit mutates only on MISMATCH (leftover server rows removed,
 * key-missed fresh rows inserted); the normal case is zero DOM writes.
 * Anchored holes (null/element markers) stay classic under hydration.
 */
import { sharedConfig } from "./hydration.js";
import { installSlotHydration, type FlatPlan, type Slot } from "./for-slot.js";

const hooks = {
  engage(
    meta: any,
    marker: Node | null | undefined,
    region: Node[] | undefined
  ): { id: string } | null | false {
    if (!sharedConfig.hydrating) return false;
    if (marker !== undefined || meta.hid === undefined || region === undefined) return null;
    return { id: meta.hid };
  },

  record<T>(slot: Slot, fn: () => T): T {
    // Shadow the registry's `delete` for the duration of the build so every
    // key the row templates consume is logged (with its node).
    const reg = sharedConfig.registry as Map<string, Element> | undefined;
    if (!reg) return fn();
    const log: [string, Element][] = (slot.hydLog ??= []);
    const proto = Map.prototype.delete;
    (reg as any).delete = function (this: Map<string, Element>, key: string): boolean {
      const node = this.get(key);
      if (node !== undefined) log.push([key, node]);
      return proto.call(this, key);
    };
    try {
      return fn();
    } finally {
      delete (reg as any).delete; // back to the prototype method
    }
  },

  restore(slot: Slot): void {
    // Nothing was placed (compute never writes DOM); only registry keys were
    // consumed. Hand them all back, and un-complete the nodes.
    slot.hyd = false;
    const reg = sharedConfig.registry as Map<string, Element> | undefined;
    const log = slot.hydLog;
    if (reg && log !== null) {
      for (let i = 0; i < log.length; i++) {
        reg.set(log[i][0], log[i][1]);
        (sharedConfig as any).completed?.delete(log[i][1]);
      }
    }
    slot.hydLog = null;
  },

  commitFill(slot: Slot, fp: FlatPlan): void {
    // Past this point the slot owns the rows for good: drop the claim log.
    slot.hyd = false;
    slot.hydLog = null;
    const ops = slot.ops;
    const ours = new Set<Node>();
    for (let i = 0; i < fp.nodes.length; i++) {
      const nd = fp.nodes[i];
      if (Array.isArray(nd)) for (const n of nd) ours.add(n);
      else ours.add(nd);
    }
    // Leftovers: server rows the client no longer has, separator comments.
    const region = slot.region!;
    for (let i = 0; i < region.length; i++)
      if (!ours.has(region[i]) && ops.contains(slot.parent, region[i])) ops.remove(region[i]);
    // Fresh rows (template key-missed → detached; the runtime already
    // warned) are inserted at their position, back to front so anchors are
    // always attached. Whole-parent: the list ends at the parent's end.
    let anchor: Node | null = null;
    for (let i = fp.nodes.length - 1; i >= 0; i--) {
      const nd = fp.nodes[i];
      if (Array.isArray(nd)) {
        for (let k = nd.length - 1; k >= 0; k--) {
          if (!ops.contains(slot.parent, nd[k])) ops.insert(slot.parent, nd[k], anchor);
          anchor = nd[k];
        }
      } else {
        if (!ops.contains(slot.parent, nd)) ops.insert(slot.parent, nd, anchor);
        anchor = nd;
      }
    }
    slot.region = undefined;
    slot.flat = { items: fp.items, owners: fp.owners, nodes: fp.nodes };
    slot.size = fp.len;
  }
};

/** Called by enableHydration(). */
export function installForSlotHydration(): void {
  installSlotHydration(hooks);
}
