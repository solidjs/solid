import type { Scenario } from "./scenario.js";
import type { RunResult } from "./runner.js";
import { scenarioKey } from "./normalize.js";
import { fingerprint, isSemanticFailure } from "./admission.js";
import { search, ordinaryKey, SearchBudget, type SearchOptions } from "./search.js";
export { fingerprint, isSemanticFailure } from "./admission.js";
export {
  reductions,
  reductionFamilies,
  reductionOrder,
  type ReductionFamily
} from "./candidates.js";
export type { ReductionStats } from "./search.js";

export interface ShrinkOptions extends SearchOptions {
  mode?: "discovery" | "focused";
  control?: (s: Scenario) => Promise<RunResult>;
}

export async function shrink(
  original: RunResult,
  run: (s: Scenario) => Promise<RunResult>,
  budget = 150,
  options: ShrinkOptions = {}
) {
  const target = fingerprint(original);
  if (!target) throw new Error("Only reproducible failures or policy findings can be shrunk");
  const discovery = options.mode !== "focused" && isSemanticFailure(original);
  const limit = new SearchBudget(budget);
  let controlAttempts = 0;
  const controlPasses = async (s: Scenario) => {
    controlAttempts++;
    const r = await limit.run(() => options.control!(s));
    return r.status === "pass" && fingerprint(r) === undefined;
  };
  if (options.control && budget > 0 && !(await controlPasses(original.scenario)))
    throw new Error("The original scenario's control must be a clean pass before shrinking");
  const reduced = await search(
    original,
    limit,
    async candidate => {
      const trial = await limit.run(() => run(candidate));
      if (discovery ? !isSemanticFailure(trial) : fingerprint(trial) !== target) return;
      if (options.control && (!limit.available() || !(await controlPasses(trial.scenario)))) return;
      return trial;
    },
    ordinaryKey,
    options
  );
  return {
    ...reduced,
    attempts: limit.executions,
    controlAttempts,
    reproKey: `${fingerprint(reduced.result)}\n${scenarioKey(reduced.result.scenario)}`
  };
}
