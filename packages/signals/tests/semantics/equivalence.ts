import { queuedSteps, validate, type Leaf, type Scenario } from "./scenario.js";
import { search, SearchBudget } from "./search.js";
import type { RunResult } from "./runner.js";
import { dataTrace } from "./rules.js";
import { fingerprint, isSemanticFailure, shrink, type ShrinkOptions } from "./shrink.js";

/** E3 has deliberately narrow preconditions: settled initial state, one write,
 * pure derivations and continuously observed readers with no fallback. Timing
 * may add stuttering but must not change the sequence of data publications. */
export type Comparison = "delivery" | "latest" | "optimistic";
function leaves(s: Scenario): Leaf[] {
  return s.turns.flatMap(turn =>
    "steps" in turn
      ? turn.steps.flatMap(step =>
          step.op === "queue" ? queuedSteps(step) : step.op === "cancel" ? [] : [step]
        )
      : []
  );
}

export function variants(s: Scenario, comparison: Comparison = "delivery"): Scenario[] {
  if (s.readers.some(r => r.render))
    throw new Error("Output attachment equivalence needs a visible-output contract");
  if (s.actions) throw new Error("Action-script equivalence needs a separate lifetime contract");
  if (s.readers.some(r => r.parent !== undefined))
    throw new Error("Nested-region equivalence is outside the current paired contracts");
  if (comparison === "optimistic") {
    if (s.version !== 1 || s.optimistic)
      throw new Error("Optimistic equivalence currently requires a single ordinary source graph");
    const base: Scenario = {
      version: 2,
      sources: [-1, -2],
      show: true,
      nodes: s.nodes.map(n => ({ ...n, deps: n.deps.map(id => (id === -1 ? -2 : id)) })),
      readers: s.readers.map(r => ({
        ...r,
        refs: r.refs.map(id => (id === -1 ? -2 : id)),
        gated: false,
        boundary: "none"
      })),
      turns: [{ steps: [{ op: "write", source: -2, value: 1 }] }]
    };
    return [
      base,
      {
        ...structuredClone(base),
        optimistic: { proposals: [1], authoritative: 0, hold: true },
        turns: [{ steps: [{ op: "start-action" }] }]
      }
    ];
  }
  if (comparison === "latest") {
    const refs = new Set<number>();
    if (s.optimistic?.kind === "latest") refs.add(-2);
    for (const turn of s.turns)
      if ("steps" in turn)
        for (const step of turn.steps)
          for (const leaf of step.op === "queue" ? queuedSteps(step) : [step])
            if (leaf.op === "read" && leaf.mode === "latest") refs.add(leaf.ref);
    return [[], [...refs]].map((warmLatest, index) => {
      const variant = structuredClone(s);
      variant.warmLatest = warmLatest;
      for (const step of leaves(variant))
        if (step.op === "resolve" && step.variantKeys) {
          const key = step.variantKeys[index];
          if (key === undefined) throw new Error("Missing paired request identity");
          delete step.variantKeys;
          if (key === null) Object.assign(step, { op: "noop" });
          else {
            step.key = key;
            variant.strict = true;
          }
        }
      return variant;
    });
  }
  if (s.optimistic)
    throw new Error("Ordinary delivery equivalence does not cover action lifetimes");
  if (s.readers.some(r => r.pending))
    throw new Error("Data-trace delivery equivalence excludes observable readiness verdicts");
  return (["sync", "promise", "await"] as const).map(delivery => ({
    ...s,
    strict: false,
    show: true,
    nodes: s.nodes.map(n => ({ ...n, delivery })),
    readers: s.readers.map(r => ({
      ...r,
      gated: false,
      boundary: "none" as const,
      ...(r.mounted !== undefined ? { mounted: true } : {})
    })),
    turns: [{ steps: [{ op: "write" as const, value: 1 }] }]
  }));
}

export function compare(
  a: RunResult,
  b: RunResult,
  comparison: Comparison = "delivery"
): RunResult {
  if (b.status !== "pass" || a.status !== "pass") return b.status !== "pass" ? b : a;
  if (
    comparison === "latest" &&
    (!b.scenario.warmLatest?.length || b.warmup?.requests || b.warmup?.pending)
  )
    return {
      ...b,
      status: "inapplicable",
      error: "Latest comparison needs an allocation-only warmup with no additional async work"
    };
  if (
    JSON.stringify(dataTrace(a.frames)) === JSON.stringify(dataTrace(b.frames)) &&
    (comparison !== "latest" ||
      (JSON.stringify(a.reads ?? []) === JSON.stringify(b.reads ?? []) &&
        JSON.stringify(a.clicks ?? []) === JSON.stringify(b.clicks ?? [])))
  )
    return b;
  return {
    ...b,
    status: "fail",
    failure: {
      rule: comparison === "latest" ? "E4" : comparison === "optimistic" ? "E5" : "E3",
      message:
        comparison === "optimistic"
          ? "A held optimistic proposal differs from the same ordinary single-write publication"
          : comparison === "latest"
            ? "Early latest creation changes later observations"
            : "Pure single-write data trace differs between sync and async delivery",
      expected:
        comparison === "latest"
          ? { frames: dataTrace(a.frames), reads: a.reads, clicks: a.clicks }
          : dataTrace(a.frames)
    }
  };
}

export async function runEquivalence(
  s: Scenario,
  run: (s: Scenario) => Promise<RunResult>,
  comparison: Comparison = "delivery"
) {
  const pair: RunResult[] = [];
  for (const variant of variants(s, comparison)) pair.push(await run(variant));
  const failed = pair.findIndex(r => r.status !== "pass");
  let relation =
    failed === -1
      ? comparison === "latest"
        ? "late-early"
        : comparison === "optimistic"
          ? "ordinary-optimistic"
          : "sync-promise"
      : `variant-${failed}`;
  let result = failed === -1 ? compare(pair[0], pair[1], comparison) : pair[failed];
  if (result.status === "pass" && comparison === "delivery") {
    relation = "sync-await";
    result = compare(pair[0], pair[2]);
  }
  // A waived finding must not disappear just because another passing variant
  // was chosen as the comparison result. Hard pair/variant failures still win.
  if (result.status === "pass") {
    const witnessed = pair.findIndex(r => r.progress?.length);
    if (witnessed !== -1) {
      result = pair[witnessed];
      relation = `variant-${witnessed}`;
    }
  }
  // Record which transformation failed. Focused shrinking preserves this relation;
  // discovery can export an independently failing variant as an ordinary case.
  const signature = fingerprint(result);
  const scenario = structuredClone(s);
  if (comparison === "latest") {
    const sides = pair.map(p => leaves(p.scenario));
    leaves(scenario).forEach((step, i) => {
      if (step.op !== "resolve" || step.variantKeys) return;
      const choices = sides.map(side => side[i]);
      // A crashed worker may not have executed every command. Do not invent
      // request identities for that unfinished prefix.
      if (choices.every(c => c?.op === "noop" || (c?.op === "resolve" && c.key))) {
        step.variantKeys = choices.map(c => (c.op === "resolve" ? c.key! : null));
        delete step.key;
      }
    });
  }
  return { pair, result, scenario, signature: signature ? `${relation}: ${signature}` : undefined };
}

export async function shrinkEquivalence(
  scenario: Scenario,
  run: (s: Scenario) => Promise<RunResult>,
  budget = 150,
  comparison: Comparison = "delivery",
  options: Pick<ShrinkOptions, "mode" | "order" | "schedule" | "stats"> = {}
) {
  const original = await runEquivalence(scenario, run, comparison);
  const target = original.signature;
  if (!target) throw new Error("Only an equivalence counterexample can be shrunk");
  const limit = new SearchBudget(budget, original.pair.length);
  const discovery = options.mode !== "focused" && isSemanticFailure(original.result);
  const singleFailure = (r: typeof original) =>
    discovery ? r.pair.find(isSemanticFailure) : undefined;
  const reduceSingle = async (result: RunResult, priorAccepted = 0) => {
    const reduced = await shrink(result, run, budget - limit.executions, options);
    return {
      ...reduced,
      pair: [] as RunResult[],
      result: reduced.result,
      scenario: reduced.result.scenario,
      signature: fingerprint(reduced.result),
      attempts: limit.executions + reduced.attempts,
      accepted: priorAccepted + reduced.accepted,
      initialExecutions: original.pair.length,
      single: true
    };
  };
  const initialSingle = singleFailure(original);
  if (initialSingle) return reduceSingle(initialSingle);
  const reduced = await search(
    original,
    limit,
    async candidate => {
      if (!limit.available(variants(candidate, comparison).length)) return;
      const trial = await runEquivalence(candidate, s => limit.run(() => run(s)), comparison);
      if (discovery ? !isSemanticFailure(trial.result) : trial.signature !== target) return;
      return trial;
    },
    s => JSON.stringify(variants(s, comparison)),
    options,
    r => !!singleFailure(r)
  );
  const single = singleFailure(reduced.result);
  if (single) {
    const final = await reduceSingle(single, reduced.accepted);
    return {
      ...final,
      candidates: reduced.candidates + final.candidates,
      invalid: reduced.invalid + final.invalid,
      duplicates: reduced.duplicates + final.duplicates,
      exhausted: reduced.exhausted || final.exhausted
    };
  }
  return {
    ...reduced,
    ...reduced.result,
    accepted: reduced.accepted,
    exhausted: reduced.exhausted || !limit.available(original.pair.length),
    attempts: limit.executions,
    initialExecutions: original.pair.length,
    single: false
  };
}
