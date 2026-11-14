/**
 * `costs()` — the cost tables: scopes ranked by the self-time they burn,
 * root writes ranked by the downstream re-run time they cause. Folded from
 * every `RerunEvent` as the engine records it.
 *
 * Its own module on purpose: the tables register with the engine's fold seam
 * when this module is evaluated, so an observe-tier consumer that only
 * subscribes to records (an APM adapter) never ships the accumulation or the
 * tables; a consumer that imports `costs` gets both. Reset with the engine on
 * `enable()`/`disable()`.
 */
import { registerFold, rootsOf, type RerunEvent } from "./attribution.js";
import type { Computed } from "./types.js";

export interface ScopeCost {
  name: string;
  kind: "effect" | "memo";
  runs: number;
  selfMs: number;
  /**
   * Self-time of PLAIN, non-held runs that produced an unchanged value —
   * the recoverable number. Overlay runs (optimistic/transition) are never
   * counted here: an optimistic recompute landing back on the committed
   * value is the mechanism working, not waste.
   */
  wastedMs: number;
  /** Self-time spent in optimistic/transition (overlay) runs. */
  overlayMs: number;
}
export interface WriteCost {
  /** Root cause name (a signal write, async landing, or refresh target). */
  name: string;
  /** Number of downstream re-runs this root triggered. */
  runs: number;
  /** Summed self-time of every downstream re-run it caused. */
  downstreamMs: number;
}
export interface AttributionCostTables {
  /** Ranked by self-time. Collected scopes share one row per name and kind. */
  scopes: ScopeCost[];
  /** Ranked by the total downstream re-run time each root write caused. */
  writes: WriteCost[];
}

// Rows outlive their nodes; keyed weakly, a table row never keeps a disposed scope.
let scopeRows = new WeakMap<Computed<any>, ScopeCost>();
const scopeCosts = new Set<ScopeCost>();
// Collected scopes share one row per name and kind, so a remount adds no row.
const retiredCosts = new Map<string, ScopeCost>();
const createRetire = () =>
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<ScopeCost>(scope => {
        if (!scopeCosts.delete(scope)) return;
        const key = `${scope.kind}:${scope.name}`;
        const sum = retiredCosts.get(key);
        if (sum === undefined) retiredCosts.set(key, { ...scope });
        else {
          sum.runs += scope.runs;
          sum.selfMs += scope.selfMs;
          sum.wastedMs += scope.wastedMs;
          sum.overlayMs += scope.overlayMs;
        }
      })
    : undefined;
let retire = createRetire();
const writeCosts = new Map<string, WriteCost>();

function recordCosts(el: Computed<any>, event: RerunEvent): void {
  let scope = scopeRows.get(el);
  if (scope === undefined) {
    scope = {
      name: event.nodeName,
      kind: event.nodeKind,
      runs: 0,
      selfMs: 0,
      wastedMs: 0,
      overlayMs: 0
    };
    scopeRows.set(el, scope);
    scopeCosts.add(scope);
    retire?.register(el, scope);
  }
  scope.runs++;
  scope.selfMs += event.selfMs;
  if (event.phase !== "plain") scope.overlayMs += event.selfMs;
  else if (!event.changed && !event.held) scope.wastedMs += event.selfMs;
  const roots = new Set<string>();
  rootsOf(event.causes, roots);
  for (const name of roots) {
    let write = writeCosts.get(name);
    if (write === undefined) writeCosts.set(name, (write = { name, runs: 0, downstreamMs: 0 }));
    write.runs++;
    write.downstreamMs += event.selfMs;
  }
}

registerFold({
  rerun: recordCosts,
  reset() {
    scopeRows = new WeakMap();
    retire = createRetire();
    scopeCosts.clear();
    retiredCosts.clear();
    writeCosts.clear();
  }
});

/**
 * Aggregated cost tables since `enable()`: `scopes` ranked by self-time
 * (with `wastedMs` = time spent on unchanged-value runs), `writes` ranked by
 * total downstream re-run time each root write caused.
 */
export function costs(): AttributionCostTables {
  return {
    scopes: [...scopeCosts, ...retiredCosts.values()].sort((a, b) => b.selfMs - a.selfMs),
    writes: [...writeCosts.values()].sort((a, b) => b.downstreamMs - a.downstreamMs)
  };
}
