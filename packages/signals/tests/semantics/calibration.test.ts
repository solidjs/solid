import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "./client.js";
import { chain } from "./fixtures.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));

test.each([
  "drop-wake",
  "stale-result",
  "lost-blocker",
  "false-ready",
  "false-verdict",
  "lost-disposal-wake",
  "lost-fallback-wake",
  "entangle-effect",
  "drop-action-hold"
])(
  "detects and reduces the %s runtime fault",
  async fault => {
    const out = await mkdtemp(join(tmpdir(), "solid-fuzz-test-"));
    try {
      await exec(process.execPath, [
        cli,
        "--calibrate",
        "--fault",
        fault,
        "--shrink",
        "--out",
        out
      ]);
      const summary = JSON.parse(await readFile(join(out, "summary.json"), "utf8"));
      expect(summary.statuses.fail).toBeGreaterThan(0);
      expect(summary.statuses.error ?? 0).toBe(0);
      const index = {
        "drop-wake": 0,
        "stale-result": 2,
        "lost-blocker": 1,
        "false-ready": 5,
        "false-verdict": 6,
        "lost-disposal-wake": 7,
        "lost-fallback-wake": 8,
        "entangle-effect": 9,
        "drop-action-hold": 10
      }[fault]!;
      const reductions = await Promise.all(
        (await readdir(out))
          .filter(file => file.endsWith("-min.json"))
          .map(async file => JSON.parse(await readFile(join(out, file), "utf8")))
      );
      const reduced =
        fault === "false-verdict"
          ? reductions.find(r => r.result.failure?.rule === "R4")
          : JSON.parse(await readFile(join(out, `case-${index}-min.json`), "utf8"));
      expect(reduced, JSON.stringify(reductions.map(r => r.result.failure))).toBeDefined();
      // The two-source fallback witness is already locally minimal.
      expect(reduced.attempts).toBeGreaterThan(0);
      if (fault !== "lost-fallback-wake") expect(reduced.accepted).toBeGreaterThan(0);
      expect(reduced.result.status).toBe("fail");
      if (fault.startsWith("lost-") && fault.endsWith("-wake"))
        expect(reduced.result.failure.rule).toBe("P1");
      if (fault === "entangle-effect") {
        expect(reduced.result.failure.rule).toBe("G2");
        expect(reduced.result.failure.expected.relation).toBe("independent");
      }
      if (fault === "drop-action-hold") expect(reduced.result.failure.rule).toBe("G1");
      if (fault === "false-ready") expect(reduced.result.failure.rule).toBe("R2");
      if (fault === "false-verdict") expect(reduced.result.failure.rule).toBe("R4");
      // The same portable case must pass against the unmodified runtime. Remove
      // build metadata because this is explicitly a cross-target comparison.
      const replay = join(out, "scenario.json");
      await writeFile(replay, JSON.stringify(reduced.scenario));
      await exec(process.execPath, [cli, "--replay", replay, "--out", join(out, "control")]);
      const control = JSON.parse(await readFile(join(out, "control", "summary.json"), "utf8"));
      expect(control.statuses).toEqual({ pass: 1 });
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  },
  20000
);

test("watchdog terminates a worker that cannot yield", async () => {
  const out = await mkdtemp(join(tmpdir(), "solid-fuzz-watchdog-"));
  const file = join(out, "worker.mjs");
  await writeFile(
    file,
    "import { parentPort } from 'node:worker_threads'; parentPort.on('message', () => { while (true) {} });"
  );
  const client = new Client(file, 200);
  try {
    const result = await client.run(chain());
    expect(result.status).toBe("limit");
    expect(result.error).toContain("watchdog");
  } finally {
    await client.close();
    await rm(out, { recursive: true, force: true });
  }
});

test("worker heap exhaustion is an inconclusive resource limit", async () => {
  const out = await mkdtemp(join(tmpdir(), "solid-fuzz-memory-"));
  const file = join(out, "worker.mjs");
  await writeFile(
    file,
    `import { parentPort } from 'node:worker_threads';
    parentPort.on('message', () => {
      const arrays = [];
      for (let i = 0; i < 64; i++) arrays.push(new Array(2_000_000).fill(i));
      parentPort.postMessage(arrays.length);
    });`
  );
  const client = new Client(file);
  try {
    const result = await client.run(chain());
    expect(result.status).toBe("limit");
    expect(result.error).toMatch(/memory limit/i);
    expect(result.diagnostics?.length ?? 0).toBeLessThanOrEqual(4096);
  } finally {
    await client.close();
    await rm(out, { recursive: true, force: true });
  }
});

test("fresh and reused workers agree on generated cases", async () => {
  const out = await mkdtemp(join(tmpdir(), "solid-fuzz-isolation-"));
  try {
    // Campaigns may find semantic counterexamples. A nonzero semantic exit is
    // expected and differs from a missing/malformed summary or process error.
    for (const fresh of [false, true]) {
      const args = [cli, "--seed", "3305", "--cases", "40", "--out", join(out, String(fresh))];
      if (fresh) args.push("--fresh");
      await exec(process.execPath, args).catch(e => {
        if (e.code !== 1) throw e;
      });
    }
    const a = JSON.parse(await readFile(join(out, "false", "summary.json"), "utf8"));
    const b = JSON.parse(await readFile(join(out, "true", "summary.json"), "utf8"));
    expect(a.statuses).toEqual(b.statuses);
    expect(a.coverage).toEqual(b.coverage);
    expect(a.failureSymptomGroups).toEqual(b.failureSymptomGroups);
    expect(a.metadata.workerHash).toEqual(b.metadata.workerHash);
    expect(a.metadata.sourceHash).toEqual(b.metadata.sourceHash);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}, 20000);

test("a progress allowance survives reporting, shrinking and replay but cannot cover fallback waiting", async () => {
  const out = await mkdtemp(join(tmpdir(), "solid-fuzz-allowance-"));
  try {
    await exec(process.execPath, [
      cli,
      "--calibrate",
      "--fault",
      "lost-disposal-wake",
      "--out",
      join(out, "ideal")
    ]);
    const ideal = JSON.parse(await readFile(join(out, "ideal", "case-7.json"), "utf8"));
    const file = join(out, "scenario.json");
    await writeFile(file, JSON.stringify(ideal.scenario));
    await exec(process.execPath, [
      cli,
      "--replay",
      file,
      "--fault",
      "lost-disposal-wake",
      "--allow",
      "legacy-disposal-wait",
      "--shrink",
      "--out",
      join(out, "allowed")
    ]);
    const allowed = JSON.parse(await readFile(join(out, "allowed", "summary.json"), "utf8"));
    expect(allowed.statuses).toEqual({ pass: 1 });
    expect(allowed.progressFindings).toBe(1);
    expect(allowed.waivedProgress).toEqual({ "legacy-disposal-wait": 1 });
    expect(allowed.retainedCases).toBe(1);
    const reduced = JSON.parse(await readFile(join(out, "allowed", "case-0-min.json"), "utf8"));
    expect(reduced.result.progress[0].allowance).toBe("legacy-disposal-wait");
    expect(reduced.accepted).toBeGreaterThan(0);
    const recorded = join(out, "allowed", "findings.jsonl");
    for (const strict of [false, true]) {
      const args = [
        cli,
        "--replay",
        recorded,
        "--index",
        "0",
        "--fault",
        "lost-disposal-wake",
        "--out",
        join(out, String(strict))
      ];
      if (strict) args.push("--allow", "none");
      await exec(process.execPath, args).catch(e => {
        if (!strict || e.code !== 1) throw e;
      });
      const result = JSON.parse(await readFile(join(out, String(strict), "case-0.json"), "utf8"));
      expect(result.result.status).toBe(strict ? "fail" : "pass");
      expect(result.result.progress[0].allowance).toBe(strict ? undefined : "legacy-disposal-wait");
      expect(result.result.frames).toEqual(ideal.result.frames);
    }
    await exec(process.execPath, [
      cli,
      "--calibrate",
      "--fault",
      "lost-fallback-wake",
      "--allow",
      "legacy-disposal-wait",
      "--out",
      join(out, "outside")
    ]);
    const outside = JSON.parse(await readFile(join(out, "outside", "case-8.json"), "utf8"));
    expect(outside.result.failure.rule).toBe("P1");
    expect(outside.result.progress[0].allowance).toBeUndefined();
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}, 20000);
