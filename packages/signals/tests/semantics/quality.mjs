// Run with --worker FILE; historical scores require the manifest's worker hash.
import { build } from "esbuild";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
const { values: args } = parseArgs({
  options: {
    worker: { type: "string" },
    baseline: { type: "string" },
    out: { type: "string" },
    budget: { type: "string", default: "500" },
    inputs: { type: "string", default: "reduced" },
    disable: { type: "string" },
    schedule: { type: "string" },
    ids: { type: "string" },
    check: { type: "boolean" }
  }
});
if (!args.worker)
  throw new Error("Provide --worker FILE: use a built semantic worker, not a source module");
const budget = Number(args.budget);
if (!Number.isInteger(budget) || budget < 0 || budget > 10000) throw new Error("Invalid budget");
if (!["original", "reduced"].includes(args.inputs))
  throw new Error("Choose --inputs original|reduced");
if (args.schedule && !["restart", "sweep"].includes(args.schedule))
  throw new Error("Invalid schedule");
const dir = fileURLToPath(new URL(".", import.meta.url)),
  temp = await mkdtemp(join(tmpdir(), "solid-fuzz-quality-"));
try {
  await build({
    stdin: {
      contents: `export * from './shrink.ts';export * from './equivalence.ts';export {Client} from './client.ts';export {scenarioKey} from './normalize.ts';export * from './complexity.ts';`,
      resolveDir: dir
    },
    outfile: join(temp, "lib.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent"
  });
  const lib = await import(pathToFileURL(join(temp, "lib.mjs")));
  const manifest = JSON.parse(
    await readFile(new URL("./quality/corpus.json", import.meta.url), "utf8")
  );
  const worker = resolve(args.worker),
    workerHash = createHash("sha256")
      .update(await readFile(worker))
      .digest("hex");
  const configurations = [];
  if (args.baseline)
    configurations.push(["baseline", await import(pathToFileURL(resolve(args.baseline)))]);
  configurations.push(["current", lib]);
  const report = {
    workerHash,
    historical: workerHash === manifest.workerSha256,
    runtime: workerHash === manifest.workerSha256 ? manifest.runtime : "custom target",
    budget,
    inputs: args.inputs,
    runs: {}
  };
  for (const [label, reducer] of configurations) {
    const client = new lib.Client(worker);
    let initialExecutions = 0,
      searchExecutions = 0,
      verificationExecutions = 0;
    const rows = [],
      keys = new Set();
    const order = reducer.reductionOrder.filter(f => !args.disable?.split(",").includes(f));
    if (args.disable?.split(",").some(f => !reducer.reductionOrder.includes(f)))
      throw new Error("Unknown reduction family");
    const start = performance.now();
    try {
      for (const item of manifest.cases) {
        if (args.ids && !args.ids.split(",").includes(item.id)) continue;
        const scenario = args.inputs === "original" ? item.input : item.reduced;
        const stats = {},
          options = { order, stats, schedule: args.schedule };
        let result,
          output,
          signature,
          single = !item.comparison,
          exhausted,
          counted,
          details,
          runtimeInvalid = 0;
        const initial = async s => {
          initialExecutions++;
          return client.run(s);
        };
        const run = async s => {
          searchExecutions++;
          const result = await client.run(s);
          if (result.status === "invalid" || result.status === "inapplicable") runtimeInvalid++;
          return result;
        };
        if (item.comparison) {
          const reduced = await reducer.shrinkEquivalence(
            scenario,
            run,
            budget,
            item.comparison,
            options
          );
          const initialCount =
            reduced.initialExecutions ?? (item.comparison === "delivery" ? 3 : 2);
          initialExecutions += initialCount;
          searchExecutions -= initialCount;
          ({ result, scenario: output, signature, single, exhausted } = reduced);
          counted = reduced.attempts;
          details = reduced;
        } else {
          const original = await initial(scenario);
          if (!reducer.fingerprint(original)) {
            rows.push({ id: item.id, status: original.status, skipped: true });
            continue;
          }
          const reduced = await reducer.shrink(original, run, budget, options);
          result = reduced.result;
          output = result.scenario;
          signature = reducer.fingerprint(result);
          exhausted = reduced.exhausted;
          counted = reduced.attempts;
          details = reduced;
        }
        const verify = async s => {
          verificationExecutions++;
          return client.run(s);
        };
        const replay = single
          ? await verify(output)
          : await reducer.runEquivalence(output, verify, item.comparison);
        if (
          (single ? reducer.fingerprint(replay) : replay.signature) !== signature ||
          (lib.isSemanticFailure(result) && !lib.isSemanticFailure(single ? replay : replay.result))
        )
          throw new Error(`${item.id} failed final replay`);
        const key = `${single ? "single" : item.comparison}:${signature}\n${lib.scenarioKey(output)}`;
        keys.add(key);
        rows.push({
          id: item.id,
          single,
          signature,
          scenario: output,
          key,
          complexity: lib.complexity(output),
          counted,
          exhausted,
          candidates: details.candidates,
          duplicates: details.duplicates,
          staticInvalid: details.invalid,
          runtimeInvalid,
          stats
        });
      }
    } finally {
      await client.close();
    }
    const routes = [];
    for (const route of manifest.routes) {
      const row = rows.find(r => r.id === route.source);
      if (!row || row.skipped) continue;
      const target = manifest.cases.find(c => c.id === route.target).reduced;
      routes.push({
        ...route,
        exact: lib.scenarioKey(row.scenario) === lib.scenarioKey(target),
        noMoreComplex: lib.compareComplexity(row.scenario, target) <= 0
      });
    }
    report.runs[label] = {
      initialExecutions,
      searchExecutions,
      verificationExecutions,
      elapsedMs: performance.now() - start,
      representatives: keys.size,
      routes,
      rows
    };
    console.log(label, JSON.stringify({ ...report.runs[label], rows: undefined }));
  }
  if (args.out) await writeFile(resolve(args.out), JSON.stringify(report, null, 2));
  const expectedRoutes = manifest.routes.filter(
    r => !args.ids || args.ids.split(",").includes(r.source)
  );
  if (
    args.check &&
    (!report.historical ||
      !expectedRoutes.length ||
      report.runs.current.routes.length !== expectedRoutes.length ||
      report.runs.current.routes.some(r => !r.noMoreComplex))
  )
    throw new Error(
      "Quality gate requires the pinned historical worker and all selected useful routes"
    );
} finally {
  await rm(temp, { recursive: true, force: true });
}
