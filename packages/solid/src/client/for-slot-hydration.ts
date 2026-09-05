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
 * Claims are RECORDED so a demote mid-fill hands them back: classic's re-run
 * mints the same ids and claims the same nodes (never a stranded claim).
 * The fill commit mutates only on MISMATCH (leftover server rows removed,
 * key-missed fresh rows inserted); the normal case is zero DOM writes.
 */
import { sharedConfig } from "./hydration.js";
import { installSlotHydration, type FlatPlan, type Slot } from "./for-slot.js";

/** RECORDING STACK. Nested lists hydrate INSIDE an outer row's build (row →
 * inner insert → inner engage → inner fill, all synchronous), so recording
 * must nest: the OUTERMOST record() installs the registry shadow once, every
 * active log on the stack receives every deletion, an inner commitFill drops
 * only its OWN log, and an outer restore() hands back everything claimed
 * beneath it — including nested slots' already-committed claims, which the
 * classic re-run's re-engaged nested lists will mint again with the same
 * ids. (Per-slot shadows broke both: the inner `finally` tore down the
 * outer's shadow, and committed inner claims were in no log at all.) */
const logs: [string, Element][][] = [];
let shadowed = false;

const hooks = {
  engage(
    meta: any,
    marker: Node | null | undefined,
    region: Node[] | undefined
  ): { id: string } | null | false {
    if (!sharedConfig.hydrating) return false;
    // Whole-parent (marker undefined) and comment-bounded holes (the
    // compiled hydrating client resolves anchored holes to the `<!--/-->`
    // marker NODE via getNextMarker, with the region as `initial`) both
    // engage. A `null` marker never occurs under hydration; decline it.
    if (marker === null || meta.hid === undefined || region === undefined) return null;
    return { id: meta.hid };
  },

  record<T>(slot: Slot, fn: () => T): T {
    const reg = sharedConfig.registry as Map<string, Element> | undefined;
    if (!reg) return fn();
    logs.push((slot.hydLog ??= []));
    const installed = !shadowed;
    if (installed) {
      shadowed = true;
      const proto = Map.prototype.delete;
      (reg as any).delete = function (this: Map<string, Element>, key: string): boolean {
        const node = this.get(key);
        if (node !== undefined) for (let i = 0; i < logs.length; i++) logs[i].push([key, node]);
        return proto.call(this, key);
      };
    }
    try {
      return fn();
    } finally {
      logs.pop();
      if (installed) {
        delete (reg as any).delete; // back to the prototype method
        shadowed = false;
      }
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
    // always attached. The list ends at the hole's end marker (or the
    // parent's end for whole-parent holes).
    let anchor: Node | null = slot.end;
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
