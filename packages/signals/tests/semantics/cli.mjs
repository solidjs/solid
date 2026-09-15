import { build } from "esbuild";
import { calibrationTarget, sourceLabel } from "./build-paths.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const dir = dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "solid-fuzz-build-"));
const workerFile = join(temp, "worker.mjs");
const args = process.argv.slice(2).filter(x => x !== "--");
const fault = args.includes("--fault") ? args[args.indexOf("--fault") + 1] : undefined;
const faults = {
  "entangle-effect": [
    "core.ts",
    "let prev: Transition | null = (el as any)._valueTransition;",
    "let prev: Transition | null = (el as any)._valueTransition; if (prev && !currentTransition(prev)._done) { globalQueue.initTransition(prev); (activeTransition!._contested ??= []).push(el); }"
  ],
  "drop-action-hold": [
    "scheduler.ts",
    "if (transition._actions.length) {",
    "if (false && transition._actions.length) {"
  ],
  "lost-disposal-wake": [
    "owner.ts",
    "if (t && n._statusFlags & STATUS_PENDING && !wokenTransitions.includes(t))",
    "if (false && t && n._statusFlags & STATUS_PENDING && !wokenTransitions.includes(t))"
  ],
  "lost-fallback-wake": [
    "scheduler.ts",
    "export function wakeParked(): void {",
    "export function wakeParked(): void { return;"
  ],
  "false-verdict": [
    "verdict.ts",
    "export function isPending(fn: () => any): boolean {",
    "export function isPending(fn: () => any): boolean { actualPending(fn); return false; }\nfunction actualPending(fn: () => any): boolean {"
  ],
  "false-ready": [
    "verdict.ts",
    "export function isPending(fn: () => any): boolean {",
    "export function isPending(fn: () => any): boolean { return false;"
  ],
  "drop-wake": [
    "scheduler.ts",
    "if (!syncDepth && !globalQueue._running && !projectionWriteActive) queueMicrotask(flush);",
    "if (!syncDepth && !globalQueue._running && !projectionWriteActive) void 0;"
  ],
  "stale-result": [
    "async.ts",
    "const asyncWrite = (value: T, then?: () => void) => {\n    if (el._x?._inFlight !== result) return;",
    "const asyncWrite = (value: T, then?: () => void) => {"
  ],
  "lost-blocker": [
    "scheduler.ts",
    "if (!reporters) activeTransition._asyncReporters.set(source, (reporters = new Set()));",
    "if (!reporters) reporters = new Set();"
  ]
};
const sources = new Map();
let mutated = false;
const adapter = {
  name: "record-and-calibrate-runtime",
  setup(build) {
    build.onLoad({ filter: /\.(ts|js)$/ }, async ({ path }) => {
      let contents = await readFile(path, "utf8");
      sources.set(sourceLabel(path, dirname(dirname(dir))), contents);
      if (fault && calibrationTarget(path, faults[fault][0])) {
        const [, before, after] = faults[fault];
        if (contents.split(before).length !== 2)
          throw new Error(`Calibration anchor drift: ${fault}`);
        contents = contents.replace(before, after);
        mutated = true;
      }
      return { contents, loader: path.endsWith(".ts") ? "ts" : "js" };
    });
  }
};
try {
  if (fault && !faults[fault]) throw new Error(`Unknown calibration fault: ${fault}`);
  const common = {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "warning"
  };
  await build({
    ...common,
    entryPoints: [join(dir, "worker.ts")],
    outfile: workerFile,
    define: { __DEV__: "true", __OBSERVE__: "true", __TEST__: "true" },
    plugins: [adapter]
  });
  if (fault && !mutated) throw new Error("Requested calibration mutation was not applied");
  const workerHash = createHash("sha256")
    .update(await readFile(workerFile))
    .digest("hex");
  await build({ ...common, entryPoints: [join(dir, "cli.ts")], outfile: join(temp, "cli.mjs") });
  const { main } = await import(pathToFileURL(join(temp, "cli.mjs")).href);
  const digest = createHash("sha256");
  for (const [path, contents] of [...sources].sort(([a], [b]) => a.localeCompare(b)))
    digest.update(path).update(contents);
  await main({ args, workerFile, workerHash, fault, sourceHash: digest.digest("hex") });
} catch (error) {
  console.error(error);
  process.exitCode = 2;
} finally {
  await rm(temp, { recursive: true, force: true });
}
