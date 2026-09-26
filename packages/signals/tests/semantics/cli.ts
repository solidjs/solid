import { mkdir, open, readFile, writeFile, type FileHandle } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client, WorkerFailure, workerLimits } from "./client.js";
import { generate } from "./generate.js";
import {
  chain,
  obsolete,
  reveal,
  readyControl,
  heldPending,
  disposedReader,
  releasedFallback,
  separateUpdates,
  heldAction
} from "./fixtures.js";
import { CandidateQueue, type Candidate } from "./selection.js";
import { scenarioKey } from "./normalize.js";
import { fingerprint, shrink, isSemanticFailure } from "./shrink.js";
import type { RunResult } from "./runner.js";
import type { Scenario } from "./scenario.js";
import { runEquivalence, shrinkEquivalence, variants } from "./equivalence.js";
import {
  allowanceIds,
  allowanceContracts,
  type Allowance,
  waitingPolicies,
  type WaitingPolicy
} from "./policy.js";
import { ruleRevision, ruleContracts } from "./rules.js";
import { corpus } from "./corpus.js";

interface Context {
  args: string[];
  workerFile: string;
  workerHash: string;
  sourceHash: string;
  fault?: string;
}

export async function main(context: Context) {
  const { values: v } = parseArgs({
    args: context.args,
    options: {
      seed: { type: "string", default: "3289" },
      cases: { type: "string", default: "1000" },
      replay: { type: "string" },
      index: { type: "string" },
      out: { type: "string" },
      fault: { type: "string" },
      timeout: { type: "string", default: "5000" },
      budget: { type: "string", default: "150" },
      shrink: { type: "boolean" },
      "shrink-mode": { type: "string", default: "discovery" },
      fresh: { type: "boolean" },
      calibrate: { type: "boolean" },
      equivalence: { type: "boolean" },
      "latest-equivalence": { type: "boolean" },
      "optimistic-equivalence": { type: "boolean" },
      corpus: { type: "boolean" },
      cohort: { type: "string" },
      "waiting-policy": { type: "string" },
      allow: { type: "string", multiple: true },
      help: { type: "boolean" }
    }
  });
  if (v.help) {
    console.log(
      "Solid semantic fuzzer\n  --seed N --cases N [--out DIR] [--fresh] [--shrink] [--budget N] (actual search executions per selected case)\n  --replay FILE [--index N for findings.jsonl] [--shrink]\n  --shrink-mode discovery|focused (default discovery)\n  --corpus\n  --cohort attachment|update-groups|ordinary|multi|optimistic|reads|mounts|latest|observation|branches|readiness|boundaries|nested|derived-readiness|optimistic-readiness|branch-boundaries\n  --waiting-policy review|required-only|retain-disposed (default review)\n  --allow legacy-disposal-wait|none (optional historical exception; default none)\n  --equivalence --seed N --cases N [--shrink]\n  --latest-equivalence --seed N --cases N [--shrink]\n  --optimistic-equivalence --seed N --cases N [--shrink]\n  --calibrate [--fault drop-wake|stale-result|lost-blocker|false-ready|false-verdict|lost-disposal-wake|lost-fallback-wake|entangle-effect|drop-action-hold]\n  --timeout MS (per-case worker watchdog; default 5000)\nArtifacts contain target hashes, canonical schedules, traces and work ledgers."
    );
    return;
  }
  const integer = (key: "seed" | "cases" | "timeout" | "budget", min: number, max: number) => {
    const n = Number(v[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid --${key}`);
    return n;
  };
  const seed = integer("seed", -2147483648, 2147483647);
  if (
    [v.equivalence, v["latest-equivalence"], v["optimistic-equivalence"]].filter(Boolean).length > 1
  )
    throw new Error("Choose one equivalence comparison");
  const paired = !!v.equivalence || !!v["latest-equivalence"] || !!v["optimistic-equivalence"];
  const comparison = v["latest-equivalence"]
    ? "latest"
    : v["optimistic-equivalence"]
      ? "optimistic"
      : "delivery";
  const count = integer("cases", 1, 10000);
  const budget = integer("budget", 0, 10000);
  const shrinkMode = v["shrink-mode"];
  if (shrinkMode !== "discovery" && shrinkMode !== "focused")
    throw new Error("Invalid --shrink-mode: choose discovery or focused");
  const timeout = integer("timeout", 1, 60000);
  let waitingPolicy = (v["waiting-policy"] ?? "review") as WaitingPolicy;
  if (!waitingPolicies.includes(waitingPolicy)) throw new Error("Invalid --waiting-policy");
  let allowances = (
    v.allow?.length === 1 && v.allow[0] === "none" ? [] : (v.allow ?? [])
  ) as Allowance[];
  if (allowances.some(id => !allowanceIds.includes(id))) throw new Error("Invalid --allow");
  const cohort = v.cohort ?? (v["latest-equivalence"] ? "reads" : "ordinary");
  if (
    ![
      "attachment",
      "update-groups",
      "ordinary",
      "multi",
      "optimistic",
      "reads",
      "mounts",
      "latest",
      "observation",
      "branches",
      "readiness",
      "boundaries",
      "nested",
      "derived-readiness",
      "optimistic-readiness",
      "branch-boundaries"
    ].includes(cohort)
  )
    throw new Error("Invalid --cohort");
  if (cohort === "optimistic" && v.equivalence)
    throw new Error("Ordinary delivery equivalence does not cover action lifetimes");
  const out = resolve(v.out ?? join(tmpdir(), `solid-semantic-fuzz-${Date.now()}-${seed}`));
  await mkdir(out, { recursive: true });
  let target = "unknown";
  try {
    target = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {}
  const metadata = {
    target,
    sourceHash: context.sourceHash,
    workerHash: context.workerHash,
    workerLimits,
    node: process.version,
    generator: "fast-check@4.9.0",
    seed,
    fault: context.fault ?? null,
    defines: { __DEV__: true, __OBSERVE__: true, __TEST__: true },
    fresh: !!v.fresh,
    equivalence: paired,
    comparison,
    ruleRevision,
    waitingPolicy,
    allowances,
    allowanceContracts,
    ruleContracts,
    cohort
  };
  const client = new Client(context.workerFile, timeout, !!v.fresh);
  const statuses: Record<string, number> = {};
  const coverage: Record<string, number> = {};
  const signatures = new Set<string>();
  const failureSignatures = new Set<string>();
  let waitingFindings = 0;
  let progressFindings = 0;
  const waivedProgress: Record<string, number> = {};
  const groupScopes: Record<string, number> = {};
  let groupChecks = 0,
    groupHeld = 0,
    batchingHeld = 0,
    possibleGroupJoins = 0;
  let attachmentCases = 0,
    attachmentChecks = 0,
    outputNodes = 0,
    privateOutputWrites = 0;
  let total = 0;
  let executions = 0;
  let operations = 0;
  let requests = 0;
  let maxReportedHeapBytes = 0;
  const started = performance.now();
  let findings: FileHandle | undefined;
  let batching: FileHandle | undefined;
  let batchingCases = 0;
  let retainedCases = 0;
  let workerErrors = 0;
  const candidates = new CandidateQueue();
  const reductionExecutions = { initial: 0, search: 0, verification: 0 };
  const searchStatuses: Record<string, number> = {};
  const reducedReports: {
    index: number;
    signature: string;
    reproKey: string;
    exhausted: boolean;
  }[] = [];
  let generationMs = 0,
    campaignMs = 0,
    reductionMs = 0,
    reportingMs = 0;
  const save = async (name: string, data: unknown) => {
    const start = performance.now();
    await writeFile(join(out, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
    reportingMs += performance.now() - start;
  };
  const reduceCandidate = async ({
    index,
    signature,
    scenario: canonical,
    result,
    pair
  }: Candidate) => {
    const start = performance.now(),
      reportStart = reportingMs;
    const before = { ...reductionExecutions };
    let initialRemaining = paired ? variants(canonical, comparison).length : 0;
    const run = async (s: Scenario) => {
      const initial = initialRemaining > 0;
      if (initial) {
        initialRemaining--;
        reductionExecutions.initial++;
      } else reductionExecutions.search++;
      const r = await client.run(s, { waitingPolicy, allowances });
      if (!initial) searchStatuses[r.status] = (searchStatuses[r.status] ?? 0) + 1;
      return r;
    };
    const verify = (s: Scenario) => {
      reductionExecutions.verification++;
      return client.run(s, { waitingPolicy, allowances });
    };
    // Later, simpler candidates get full artifacts too. Originals remain in JSONL.
    await save(`case-${index}`, { metadata, index, scenario: canonical, result, pair });
    if (!paired) {
      const reduced = await shrink(result, run, budget, { mode: shrinkMode });
      const replay = await verify(reduced.result.scenario);
      const signature = fingerprint(reduced.result)!;
      if (
        fingerprint(replay) !== signature ||
        (isSemanticFailure(reduced.result) && !isSemanticFailure(replay))
      )
        throw new Error("Reduced failure did not replay cleanly");
      reducedReports.push({
        index,
        signature,
        reproKey: reduced.reproKey,
        exhausted: reduced.exhausted
      });
      await save(`case-${index}-min`, {
        metadata,
        index,
        originalSignature: fingerprint(result),
        shrinkMode,
        scenario: reduced.result.scenario,
        ...reduced,
        executionCounts: { initial: 0, search: reduced.attempts, verification: 1 }
      });
    } else {
      const reduced = await shrinkEquivalence(canonical, run, budget, comparison, {
        mode: shrinkMode
      });
      let replayResult: RunResult, replaySignature: string | undefined;
      if (reduced.single) {
        replayResult = await verify(reduced.scenario);
        replaySignature = fingerprint(replayResult);
      } else {
        const replay = await runEquivalence(reduced.scenario, verify, comparison);
        replayResult = replay.result;
        replaySignature = replay.signature;
      }
      if (
        replaySignature !== reduced.signature ||
        (isSemanticFailure(reduced.result) && !isSemanticFailure(replayResult))
      )
        throw new Error("Reduced pair did not replay cleanly");
      const reproKey = `${reduced.single ? "single" : comparison}:${reduced.signature}\n${scenarioKey(reduced.scenario)}`;
      reducedReports.push({
        index,
        signature: reduced.signature!,
        reproKey,
        exhausted: reduced.exhausted
      });
      await save(`case-${index}-min`, {
        metadata: {
          ...metadata,
          equivalence: !reduced.single,
          comparison: reduced.single ? undefined : comparison
        },
        index,
        originalSignature: signature,
        shrinkMode,
        ...reduced,
        reproKey,
        executionCounts: {
          initial: reduced.initialExecutions,
          search: reduced.attempts,
          verification: reductionExecutions.verification - before.verification
        }
      });
    }
    reductionMs += performance.now() - start - (reportingMs - reportStart);
    console.log(
      `  Case ${index}: reduced with ${reductionExecutions.search - before.search} search executions; independently replayed`
    );
  };
  try {
    const generationStart = performance.now();
    let scenarios: Scenario[];
    if (v.replay) {
      const contents = await readFile(resolve(v.replay), "utf8");
      let artifact;
      if (v.replay.endsWith(".jsonl")) {
        const index = Number(v.index);
        if (v.index === undefined || !Number.isInteger(index) || index < 0)
          throw new Error("JSONL replay requires --index N");
        for (const line of contents.split("\n")) {
          if (!line) continue;
          const entry = JSON.parse(line);
          if (entry.index === index) {
            artifact = entry;
            break;
          }
        }
        if (!artifact) throw new Error(`No retained case at index ${index}`);
      } else artifact = JSON.parse(contents);
      if (
        artifact.metadata?.equivalence &&
        (!paired || (artifact.metadata.comparison ?? "delivery") !== comparison)
      )
        throw new Error(
          "Use the recorded comparison: --equivalence, --latest-equivalence or --optimistic-equivalence"
        );
      if (artifact.metadata && artifact.metadata.fault !== (context.fault ?? null))
        throw new Error("Replay fault differs from artifact; pass the recorded --fault explicitly");
      if (artifact.metadata?.workerHash && artifact.metadata.workerHash !== context.workerHash)
        console.warn(
          "Replay uses a different worker bundle than the artifact; results may differ."
        );
      const recordedPolicy = artifact.metadata?.waitingPolicy;
      if (recordedPolicy && !waitingPolicies.includes(recordedPolicy))
        throw new Error("Unsupported replay waiting policy");
      if (recordedPolicy && !v["waiting-policy"]) waitingPolicy = recordedPolicy;
      metadata.waitingPolicy = waitingPolicy;
      const recordedAllowances = artifact.metadata?.allowances;
      if (
        recordedAllowances !== undefined &&
        (!Array.isArray(recordedAllowances) ||
          recordedAllowances.some(id => !allowanceIds.includes(id)))
      )
        throw new Error("Unsupported replay allowances");
      if (recordedAllowances && !v.allow) allowances = recordedAllowances;
      metadata.allowances = allowances;
      scenarios = [artifact.scenario ?? artifact.result?.scenario ?? artifact];
    } else if (v.calibrate)
      scenarios = [
        chain("sync"),
        chain(),
        obsolete(),
        reveal(),
        reveal("reset"),
        readyControl(),
        heldPending(),
        disposedReader(),
        releasedFallback(),
        separateUpdates(),
        heldAction()
      ];
    else if (v.corpus) scenarios = corpus.map(c => c.scenario);
    else scenarios = generate(seed, count, cohort as import("./generate.js").Cohort);
    generationMs = performance.now() - generationStart;
    const campaignStart = performance.now(),
      reportStart = reportingMs,
      reduceStart = reductionMs;
    findings = await open(join(out, "findings.jsonl"), "w");
    try {
      for (const scenario of scenarios) {
        const pair: RunResult[] = [];
        let canonical = scenario;
        let pairSignature: string | undefined;
        let result: RunResult;
        if (paired) {
          const compared = await runEquivalence(
            scenario,
            s => client.run(s, { waitingPolicy, allowances }),
            comparison
          );
          pair.push(...compared.pair);
          result = compared.result;
          canonical = compared.scenario;
          pairSignature = compared.signature;
        } else result = await client.run(scenario, { waitingPolicy, allowances });
        const index = total++;
        statuses[result.status] = (statuses[result.status] ?? 0) + 1;
        if (result.waiting) waitingFindings++;
        if (result.progress?.length) {
          progressFindings++;
          for (const finding of result.progress)
            if (finding.allowance)
              waivedProgress[finding.allowance] = (waivedProgress[finding.allowance] ?? 0) + 1;
        }
        const runs = paired ? pair : [result];
        executions += runs.length;
        for (const tag of new Set(runs.flatMap(r => r.coverage)))
          coverage[tag] = (coverage[tag] ?? 0) + 1;
        for (const r of runs) {
          if (r.attachment) {
            attachmentCases++;
            attachmentChecks += r.attachment.checks;
            outputNodes += r.attachment.nodes;
            privateOutputWrites += r.attachment.privateWrites;
          }
          if (r.groups) {
            const scope = r.groups.scope ?? "checked";
            groupScopes[scope] = (groupScopes[scope] ?? 0) + 1;
            groupChecks += r.groups.checks;
            groupHeld += r.groups.held;
            batchingHeld += r.groups.batchingHeld;
            possibleGroupJoins += r.groups.possibleJoins;
            if (r.groups.batchingHeld) {
              batching ??= await open(join(out, "batching.jsonl"), "w");
              const reportStart = performance.now();
              await batching.write(
                JSON.stringify({ index, scenario: r.scenario, metadata, groups: r.groups }) + "\n"
              );
              reportingMs += performance.now() - reportStart;
              batchingCases++;
            }
          }
          operations += r.metrics.operations;
          requests += r.metrics.requests;
          maxReportedHeapBytes = Math.max(maxReportedHeapBytes, r.metrics.heapUsedBytes ?? 0);
        }
        const signature =
          pairSignature ??
          fingerprint(result) ??
          `${result.status}: ${result.error?.split("\n")[0]}`;
        if (result.status === "fail") failureSignatures.add(signature);
        if (result.status !== "pass" || result.waiting || result.progress?.length) {
          const reportStart = performance.now();
          await findings.write(
            JSON.stringify({
              index,
              signature,
              scenario: paired ? canonical : result.scenario,
              metadata: {
                workerHash: context.workerHash,
                sourceHash: context.sourceHash,
                fault: context.fault ?? null,
                equivalence: paired,
                comparison,
                waitingPolicy,
                allowances,
                ruleRevision
              },
              status: result.status,
              failure: result.failure,
              error: result.error,
              waiting: result.waiting?.disposition,
              progress: result.progress
            }) + "\n"
          );
          reportingMs += performance.now() - reportStart;
          retainedCases++;
        }
        if (v.shrink && !v.calibrate && !v.replay && fingerprint(result))
          candidates.offer({
            index,
            signature,
            scenario: paired ? canonical : result.scenario,
            result,
            pair
          });
        if (
          (result.status !== "pass" || result.waiting || result.progress?.length) &&
          !signatures.has(signature)
        ) {
          signatures.add(signature);
          if (signatures.size > 20) continue;
          await save(`case-${index}`, {
            metadata,
            index,
            scenario: paired ? canonical : result.scenario,
            result,
            ...(v.corpus ? { corpus: corpus[index] } : {}),
            ...(paired ? { pair } : {})
          });
          console.log(`Case ${index}: ${signature}`);
          if (v.shrink && fingerprint(result) && (v.calibrate || v.replay))
            await reduceCandidate({ index, signature, scenario: canonical, result, pair });
        }
        if (total % 1000 === 0) console.log(`${total}/${scenarios.length} cases`);
      }
      campaignMs =
        performance.now() -
        campaignStart -
        (reportingMs - reportStart) -
        (reductionMs - reduceStart);
      for (const candidate of candidates.entries) await reduceCandidate(candidate);
      if (v.shrink) await save("reductions", reducedReports);
      await client.close();
      client.checkHealth();
    } catch (error) {
      if (!(error instanceof WorkerFailure)) throw error;
      workerErrors++;
      await save("worker-error", {
        metadata,
        scenario: error.result.scenario,
        result: error.result
      });
      console.error(
        "Worker failed after reporting a case; original input saved in worker-error.json"
      );
    }
    const elapsedMs = performance.now() - started;
    const summary = {
      metadata,
      total,
      executions,
      statuses,
      coverage,
      operations,
      requests,
      maxReportedHeapBytes,
      elapsedMs,
      generationMs,
      campaignMs,
      reductionMs,
      reportingMs,
      reductionExecutions,
      searchStatuses,
      reducedCandidates: reducedReports.length,
      reducedReproKeys: new Set(reducedReports.map(r => r.reproKey)).size,
      casesPerSecond: total / (elapsedMs / 1000),
      failureSymptomGroups: failureSignatures.size,
      findingSymptomGroups: signatures.size,
      retainedCases,
      workerErrors,
      waitingFindings,
      progressFindings,
      waivedProgress,
      groupScopes,
      groupChecks,
      groupHeld,
      batchingHeld,
      batchingCases,
      possibleGroupJoins,
      attachmentCases,
      attachmentChecks,
      outputNodes,
      privateOutputWrites
    };
    await save("summary", summary);
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Artifacts: ${out}`);
    if (v.calibrate && context.fault) {
      if (workerErrors || statuses.error || statuses.limit || statuses.invalid)
        throw new Error(
          "Calibration had runtime errors or inconclusive cases; detection is not established"
        );
      if (!statuses.fail) throw new Error("Calibration fault was not detected");
    } else if (workerErrors || Object.keys(statuses).some(status => status !== "pass"))
      process.exitCode = 1;
  } finally {
    await findings?.close();
    await batching?.close();
    await client.close();
  }
}
