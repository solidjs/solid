// Optional decision gates; never used by the campaign runner.
import { build } from "esbuild";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
const { values: args } = parseArgs({
  options: {
    worker: { type: "string" },
    out: { type: "string" },
    experiment: { type: "string" },
    budget: { type: "string", default: "150" }
  }
});
if (!args.worker || !["native", "chunks", "selection"].includes(args.experiment))
  throw Error("Provide --worker FILE --experiment native|chunks|selection [--out FILE]");
const budget = Number(args.budget);
if (!Number.isInteger(budget) || budget < 1 || budget > 10000) throw Error("Invalid budget");
const dir = fileURLToPath(new URL(".", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "solid-fuzz-experiment-"));
try {
  await build({
    stdin: {
      contents: `export {scenarioArbitrary,branchesArbitrary} from './generate.ts';export {Client} from './client.ts';export * from './shrink.ts';export * from './complexity.ts';export {validate} from './scenario.ts';export {CandidateQueue} from './selection.ts';export * as fc from 'fast-check';`,
      resolveDir: dir
    },
    outfile: join(temp, "lib.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent"
  });
  const lib = await import(pathToFileURL(join(temp, "lib.mjs")));
  const worker = resolve(args.worker),
    client = new lib.Client(worker),
    rows = [];
  const checked = async s => {
    const r = await client.run(s);
    if (r.status === "error" || r.status === "limit")
      throw Error(`Experiment interrupted: ${r.status}`);
    return r;
  };
  const verify = async r => {
    if (!lib.isSemanticFailure(await checked(r.scenario)))
      throw Error("Final witness did not replay");
  };
  try {
    if (args.experiment === "native") {
      for (const [cohort, arb] of [
        ["ordinary", lib.scenarioArbitrary],
        ["branches", lib.branchesArbitrary]
      ]) {
        for (const seed of [91500, 91501, 91502, 91503, 91504]) {
          let calls = 0,
            first,
            best,
            firstCalls = 0,
            invalid = 0,
            unexpected;

          const details = await lib.fc.check(
            lib.fc.asyncProperty(arb, async s => {
              if (first && calls - firstCalls >= budget) throw new lib.fc.PreconditionFailure(true);
              calls++;
              let r;
              try {
                r = await checked(s);
              } catch (error) {
                unexpected = error;
                throw error;
              }
              if (r.status === "invalid" || r.status === "inapplicable") {
                invalid++;
                return true;
              }
              if (!lib.isSemanticFailure(r)) return true;
              if (!first) {
                first = r;
                firstCalls = calls;
              }
              if (!best || lib.compareComplexity(r.scenario, best.scenario) < 0) best = r;
              return false;
            }),
            { seed, numRuns: 150 }
          );
          if (unexpected) throw unexpected;
          if (!first) {
            rows.push({ cohort, seed, found: false, calls });
            continue;
          }
          const external = await lib.shrink(first, checked, budget);
          const hybrid = await lib.shrink(
            best,
            checked,
            Math.max(0, budget - (calls - firstCalls))
          );
          for (const r of [best, external.result, hybrid.result]) await verify(r);
          rows.push({
            cohort,
            seed,
            first: lib.complexity(first.scenario),
            native: lib.complexity(best.scenario),
            external: lib.complexity(external.result.scenario),
            hybrid: lib.complexity(hybrid.result.scenario),
            nativeCalls: calls - firstCalls,
            externalCalls: external.attempts,
            hybridCalls: hybrid.attempts,
            invalid,
            interrupted: details.interrupted
          });
        }
      }
    } else if (args.experiment === "selection") {
      const manifest = JSON.parse(
        await readFile(new URL("./quality/corpus.json", import.meta.url), "utf8")
      );
      const first = [],
        signatures = new Set(),
        queue = new lib.CandidateQueue();
      for (let index = 0; index < manifest.cases.length; index++) {
        const item = manifest.cases[index];
        if (item.comparison) continue;
        const result = await checked(item.input);
        if (!lib.isSemanticFailure(result)) continue;
        const signature = lib.fingerprint(result);
        const candidate = { index, signature, scenario: result.scenario, result, pair: [] };
        if (!signatures.has(signature) && first.length < queue.capacity) first.push(candidate);
        signatures.add(signature);
        queue.offer(candidate);
      }
      for (const [mode, selected] of [
        ["first", first],
        ["queue", queue.entries]
      ]) {
        for (const c of selected) {
          const reduced = await lib.shrink(c.result, checked, budget);
          await verify(reduced.result);
          rows.push({
            mode,
            id: manifest.cases[c.index].id,
            signature: c.signature,
            raw: lib.complexity(c.scenario),
            final: lib.complexity(reduced.result.scenario),
            calls: reduced.attempts
          });
        }
      }
    } else {
      const manifest = JSON.parse(
        await readFile(new URL("./quality/corpus.json", import.meta.url), "utf8")
      );
      // Same ordered turn deletion units for both algorithms. CDD: Algorithm 2,
      // https://arxiv.org/html/2408.04735v4, p0=.25; no complement queries.
      for (const item of manifest.cases) {
        if (item.comparison) continue;
        const first = await checked(item.input);
        if (!lib.isSemanticFailure(first)) continue;
        const row = { id: item.id };
        for (const mode of ["halving", "cdd"]) {
          let result = first,
            calls = 0,
            invalid = 0;
          const seen = new Set();
          const remove = async (start, count) => {
            const turns = result.scenario.turns.slice();
            turns.splice(start, count);
            const candidate = { ...result.scenario, turns };
            if (lib.validate(candidate)) {
              invalid++;
              return false;
            }
            const key = JSON.stringify(candidate);
            if (seen.has(key) || calls >= budget) return false;
            seen.add(key);
            calls++;
            const next = await checked(candidate);
            if (next.status === "invalid" || next.status === "inapplicable") invalid++;
            if (!lib.isSemanticFailure(next)) return false;
            result = next;
            return true;
          };
          if (mode === "halving") {
            let changed = true;
            while (changed && calls < budget) {
              changed = false;
              outer: for (
                let width = Math.max(1, Math.ceil(result.scenario.turns.length / 2));
                width;
                width = Math.floor(width / 2)
              ) {
                for (let i = 0; i < result.scenario.turns.length && calls < budget; i += width) {
                  if (await remove(i, width)) {
                    changed = true;
                    break outer;
                  }
                }
              }
            }
          } else {
            for (let round = 0; calls < budget; round++) {
              const p = 0.25 * 1.582 ** round;
              let width = 1,
                gain = 1 - p;
              for (let s = 2; s <= result.scenario.turns.length && p < 1; s++) {
                const next = s * (1 - p) ** s;
                if (next <= gain) break;
                width = s;
                gain = next;
              }
              const length = result.scenario.turns.length;
              let removed = 0;
              for (let i = 0; i < length && calls < budget; i += width) {
                const count = Math.min(width, length - i);
                if (await remove(i - removed, count)) removed += count;
              }
              if (width === 1) break;
            }
          }
          const finish = await lib.shrink(result, checked, budget - calls);
          await verify(finish.result);
          row[mode] = {
            chunkCalls: calls,
            calls: calls + finish.attempts,
            invalid,
            complexity: lib.complexity(finish.result.scenario)
          };
        }
        rows.push(row);
      }
    }
  } finally {
    await client.close();
  }
  const report = {
    experiment: args.experiment,
    budget,
    workerHash: createHash("sha256")
      .update(await readFile(worker))
      .digest("hex"),
    rows
  };
  if (args.out) await writeFile(resolve(args.out), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  await rm(temp, { recursive: true, force: true });
}
