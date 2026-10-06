import { build } from "esbuild";
import { calibrationTarget, sourceLabel } from "./build-paths.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const dir = dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "solid-fuzz-build-"));
const workerFile = join(temp, "worker.mjs");
const args = process.argv.slice(2).filter(x => x !== "--");
const fault = args.includes("--fault") ? args[args.indexOf("--fault") + 1] : undefined;
// Each fault names an L2 mechanism (re-anchored 2026-10-05 for #3774, "the
// hold model"; the pre-L2 anchors — `_valueTransition`, `transition._actions`,
// `wokenTransitions`, `wakeParked`, `_asyncReporters` — are gone). Anchors are
// exact source text and fail loudly when the implementation moves.
const faults = {
  // A15 shared-hole corollary: a render effect reading a node another
  // transaction holds is a stale reader (`frameRead`) and entangles nothing.
  // The fault makes the writer's tick join that hold anyway.
  "entangle-effect": [
    "core.ts",
    "  staleReader(c, t);\n  return true;\n}",
    "  staleReader(c, t);\n  joinPassTx(t);\n  return true;\n}"
  ],
  // `blocked(t)`: an action still running in `t` holds it open (`_open`).
  "drop-action-hold": ["scheduler.ts", "    t._open !== 0 ||", "    false && t._open !== 0 ||"],
  // A death that can unblock the future schedules a seam (owner.ts). Without
  // it a parked transaction whose last reader died is never re-judged.
  "lost-disposal-wake": [
    "owner.ts",
    "      flags & REACTIVE_FRAME_READ\n    )\n      schedule();",
    "      flags & REACTIVE_FRAME_READ\n    )\n      void 0;"
  ],
  // `lost-fallback-wake` (pre-L2: `wakeParked` returning early) is retired.
  // L2 has no fallback "wake" to lose: the seam re-judges `blocked` every
  // flush, and a boundary's swap to its fallback clears its frame reader's
  // pending, so the hold dissolves structurally (A33). The one L2 arm that
  // states A33 — `onScreen`'s `_hidden` check — is unobservable in this
  // harness's reader shape (the reader is a render effect of the boundary's
  // output, never a render effect inside the content), and faulting it
  // together with the blocker predicate holds the swap itself rather than
  // keeping a shown fallback beside unpublished writes. P1's fallback
  // release is pinned on the unmodified runtime by `--calibrate` case 8 and
  // `progress.test.ts`; the allowance's scope by `progress.test.ts`.
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
  // `schedule()`: the flush a write queues.
  "drop-wake": ["scheduler.ts", "    queueMicrotask(flush);", "    void 0;"],
  "stale-result": [
    "async.ts",
    "const asyncWrite = (value: T, then?: () => void) => {\n    if (el._x?._inFlight !== result) return;",
    "const asyncWrite = (value: T, then?: () => void) => {"
  ],
  // `blockedBy`: the frame readers observing a held flight are what holds a
  // transaction. The fault never finds one, so every park lands at once.
  "lost-blocker": [
    "scheduler.ts",
    "function blockedBy(nodes: Signal<any>[], owner: Transaction, own = false): boolean {",
    "function blockedBy(nodes: Signal<any>[], owner: Transaction, own = false): boolean {\n  return false;"
  ]
};
// SOLID_FUZZ_TARGET_SRC runs this harness, unchanged, against another
// revision's `packages/signals/src` (e.g. a `git archive` of it). Every import
// that resolves into this checkout's signals source is redirected there, and a
// load from this checkout's source fails the build, so two runtimes never mix.
const ownSrc = join(dirname(dirname(dir)), "src");
const targetSrc = process.env.SOLID_FUZZ_TARGET_SRC
  ? resolve(process.env.SOLID_FUZZ_TARGET_SRC)
  : undefined;
const runtime = targetSrc
  ? { src: targetSrc, sha: process.env.SOLID_FUZZ_TARGET_SHA ?? null }
  : undefined;
const redirect = {
  name: "redirect-runtime",
  setup(build) {
    build.onResolve({ filter: /^\./ }, ({ path, resolveDir }) => {
      const absolute = resolve(resolveDir, path);
      if (!absolute.startsWith(ownSrc + sep)) return;
      let mapped = join(targetSrc, absolute.slice(ownSrc.length + 1));
      if (mapped.endsWith(".js") && existsSync(mapped.slice(0, -3) + ".ts"))
        mapped = mapped.slice(0, -3) + ".ts";
      if (!existsSync(mapped)) throw new Error(`Target runtime lacks ${mapped}`);
      return { path: mapped };
    });
  }
};
const sources = new Map();
let mutated = false;
const adapter = {
  name: "record-and-calibrate-runtime",
  setup(build) {
    build.onLoad({ filter: /\.(ts|js)$/ }, async ({ path }) => {
      if (targetSrc && path.startsWith(ownSrc + sep))
        throw new Error(`Harness runtime leaked into a redirected build: ${path}`);
      let contents = await readFile(path, "utf8");
      sources.set(sourceLabel(path, dirname(dirname(dir))), contents);
      if (fault && calibrationTarget(path, faults[fault][0])) {
        const [, before, after] = faults[fault];
        // One anchor, or several applied together (a mechanism spread over
        // two sites); every anchor must match exactly once.
        const befores = Array.isArray(before) ? before : [before];
        const afters = Array.isArray(after) ? after : [after];
        for (let i = 0; i < befores.length; i++) {
          if (contents.split(befores[i]).length !== 2)
            throw new Error(`Calibration anchor drift: ${fault}`);
          contents = contents.replace(befores[i], afters[i]);
        }
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
    plugins: targetSrc ? [redirect, adapter] : [adapter]
  });
  if (fault && !mutated) throw new Error("Requested calibration mutation was not applied");
  const workerHash = createHash("sha256")
    .update(await readFile(workerFile))
    .digest("hex");
  await build({
    ...common,
    entryPoints: [join(dir, "cli.ts")],
    outfile: join(temp, "cli.mjs"),
    plugins: targetSrc ? [redirect] : []
  });
  const { main } = await import(pathToFileURL(join(temp, "cli.mjs")).href);
  const digest = createHash("sha256");
  for (const [path, contents] of [...sources].sort(([a], [b]) => a.localeCompare(b)))
    digest.update(path).update(contents);
  await main({ args, workerFile, workerHash, fault, sourceHash: digest.digest("hex"), runtime });
} catch (error) {
  console.error(error);
  process.exitCode = 2;
} finally {
  await rm(temp, { recursive: true, force: true });
}
