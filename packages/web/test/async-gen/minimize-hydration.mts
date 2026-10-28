/**
 * Minimizes a scenario failing the hydration campaign. Each round renders
 * every one-edit reduction of the current scenario through both halves (the
 * server spec with ASYNC_GEN_REPLAY, then the hydrate spec) and keeps the
 * smallest that still breaks the law, until none does.
 *
 *   node test/async-gen/minimize-hydration.mts <scenario.json> <law>
 *
 * Run from packages/web; `law` is a hydration finding's law (refetch,
 * hydrated-vs-csr, final-screen, console-error, …).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { edits } from "./minimize.ts";
import type { Scenario } from "./scenario.ts";

const [file, law] = process.argv.slice(2);
if (!file || !law) throw new Error("usage: minimize-hydration.mts <scenario.json> <law>");
const GEN = resolve(process.cwd(), "test/async-gen/__gen__");
const replay = resolve(tmpdir(), `async-gen-replay-${process.pid}.json`);
const size = (sc: Scenario) => JSON.stringify(sc).length;

function failing(batch: Scenario[]): boolean[] {
  writeFileSync(replay, JSON.stringify(batch));
  const env = { ...process.env, ASYNC_GEN_HY: "1", ASYNC_GEN_REPLAY: replay };
  const run = (config: string, spec: string) => {
    try {
      execFileSync("npx", ["vitest", "run", "--config", config, spec], { env, stdio: "pipe" });
    } catch {}
  };
  run("vite.config.server.mjs", "test/server/async-gen.gen.spec.tsx");
  run("vite.config.hydrate.mjs", "test/consistency/async-gen");
  const results = JSON.parse(readFileSync(resolve(GEN, "results.json"), "utf8")) as {
    i: number;
    laws: string[];
  }[];
  const out = batch.map(() => false);
  for (const r of results) out[r.i] = r.laws.includes(law);
  return out;
}

let cur = JSON.parse(readFileSync(file, "utf8")) as Scenario;
if (!failing([cur])[0]) throw new Error(`the scenario does not break ${law}`);
for (let round = 1; ; round++) {
  const cands = edits(cur).filter(c => size(c) < size(cur));
  if (!cands.length) break;
  const fails = failing(cands);
  const next = cands.filter((_, i) => fails[i]).sort((a, b) => size(a) - size(b))[0];
  if (!next) break;
  cur = next;
  process.stdout.write(`round ${round}: ${size(cur)} chars\n`);
}
process.stdout.write(JSON.stringify(cur) + "\n");
