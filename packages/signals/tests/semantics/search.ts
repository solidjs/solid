import { validate, type Scenario } from "./scenario.js";
import { canonicalize } from "./reduce.js";
import { OrderingLimit } from "./order.js";
import { compareSize } from "./complexity.js";
import {
  reductionFamilies,
  reductionOrder,
  expensiveFamilies,
  type ReductionFamily
} from "./candidates.js";

export interface ReductionStats {
  attempts: number;
  accepted: number;
  elapsedMs: number;
}

/** Counts actual interpreter executions, including comparison sides and controls. */
export class SearchBudget {
  executions = 0;
  candidates = 0;
  readonly candidateLimit: number;
  constructor(
    readonly limit: number,
    readonly minimum = 1
  ) {
    this.candidateLimit = Math.max(1000, limit * 100);
  }
  available(count = this.minimum) {
    return this.executions + count <= this.limit;
  }
  async run<T>(execute: () => Promise<T>): Promise<T> {
    if (!this.available(1)) throw new Error("Reduction execution budget exceeded");
    this.executions++;
    return execute();
  }
}

export interface SearchOptions {
  order?: readonly ReductionFamily[];
  stats?: Partial<Record<ReductionFamily, ReductionStats>>;
  /** Kept for controlled comparison; sweeps avoid retrying earlier passes on every edit. */
  schedule?: "restart" | "sweep";
}

/** Shared traversal only. Admission, comparison and controls belong to callers. */
export async function search<T extends { scenario: Scenario }>(
  initial: T,
  budget: SearchBudget,
  trial: (scenario: Scenario) => Promise<T | undefined>,
  key: (scenario: Scenario) => string,
  options: SearchOptions,
  stop?: (result: T) => boolean
) {
  let result = initial,
    accepted = 0,
    duplicates = 0,
    candidates = 0,
    invalid = 0;
  let changedOrder = false;
  const seen = new Set([key(initial.scenario)]);
  const ordering = new OrderingLimit(initial.scenario);
  const order = options.order ?? reductionOrder;
  const schedule = options.schedule ?? "sweep";
  let finishing = false,
    expensive = false;
  // A fresh generator sees accepted edits; seen candidates are never replayed.
  // Stay in the current family on success, advancing to earlier families next sweep.
  let progress = true;
  outer: while (progress && budget.available() && budget.candidates < budget.candidateLimit) {
    progress = false;
    for (let i = 0; i < order.length; i++) {
      const family = order[i];
      if (finishing && family === "deliveryOrdering") continue;
      if (!expensive && expensiveFamilies.has(family)) continue;
      let again = true;
      while (again && budget.available()) {
        again = false;
        for (const candidate of reductionFamilies[family](result.scenario)) {
          if (budget.candidates >= budget.candidateLimit) break outer;
          budget.candidates++;
          candidates++;
          if (validate(candidate)) {
            invalid++;
            continue;
          }
          if (family === "deliveryOrdering" && !ordering.allows(candidate)) continue;
          const candidateKey = key(candidate);
          if (seen.has(candidateKey)) {
            duplicates++;
            continue;
          }
          if (!budget.available()) break outer;
          seen.add(candidateKey);
          const stats =
            options.stats && (options.stats[family] ??= { attempts: 0, accepted: 0, elapsedMs: 0 });
          const before = budget.executions,
            started = stats ? performance.now() : 0;
          let next = await trial(candidate);
          if (next && family === "deliveryEscape") {
            const order = (options.order ?? reductionOrder).filter(f => !expensiveFamilies.has(f));
            const finish = await search(
              next,
              budget,
              trial,
              key,
              { order, schedule: "sweep" },
              stop
            );
            candidates += finish.candidates;
            duplicates += finish.duplicates;
            invalid += finish.invalid;
            next =
              compareSize(finish.result.scenario, result.scenario) < 0 ? finish.result : undefined;
          }
          if (stats) {
            stats.attempts += budget.executions - before;
            stats.elapsedMs += performance.now() - started;
          }
          if (!next) continue;
          result = next;
          seen.add(key(result.scenario));
          ordering.accept(result.scenario);
          accepted++;
          if (stats) stats.accepted++;
          if (family === "deliveryOrdering") changedOrder = true;
          progress = true;
          if (stop?.(result)) break outer;
          if (schedule === "restart") {
            i = -1;
            break;
          }
          again = true;
          break;
        }
      }
    }
    if (!progress && !expensive && order.some(f => expensiveFamilies.has(f))) {
      expensive = true;
      progress = true;
    }
    if (!progress && changedOrder && !finishing && budget.available()) {
      // One ordinary finishing sweep, sharing the budget; no recursive search.
      finishing = true;
      seen.clear();
      seen.add(key(result.scenario));
      progress = true;
    }
  }
  return {
    result,
    accepted,
    duplicates,
    candidates,
    invalid,
    exhausted: !budget.available() || budget.candidates >= budget.candidateLimit
  };
}

export const ordinaryKey = (s: Scenario) => JSON.stringify(canonicalize(s));
