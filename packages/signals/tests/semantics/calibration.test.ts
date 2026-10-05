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

// `lost-fallback-wake` was retired with L2 (#3774): a boundary reset's
// release is structural there, not a wake (see the fault table in cli.mjs).
test.each([
  "drop-wake",
  "stale-result",
  "lost-blocker",
  "false-ready",
  "false-verdict",
  "lost-disposal-wake",
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
      expect(reduced.attempts).toBeGreaterThan(0);
      expect(reduced.accepted).toBeGreaterThan(0);
      expect(reduced.result.status).toBe("fail");
      if (fault === "lost-disposal-wake") expect(reduced.result.failure.rule).toBe("P1");
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

// S1's in-flight exemption (revision 19) accepts only answers a node produced
// for its newest question: an answer to a superseded question landing inside
// the window (calibration case 11) is still S1.
test("stale-result inside S1's in-flight window is still detected", async () => {
  const out = await mkdtemp(join(tmpdir(), "solid-fuzz-inflight-"));
  try {
    await exec(process.execPath, [cli, "--calibrate", "--fault", "stale-result", "--out", out]);
    const found = (await readFile(join(out, "findings.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(line => JSON.parse(line))
      .find(f => f.index === 11);
    expect(found?.status).toBe("fail");
    expect(found.failure.rule).toBe("S1");
    expect(found.failure.frame.inflight).toBeDefined();
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}, 20000);

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

test("a progress allowance survives reporting, shrinking and replay", async () => {
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
    // The allowance never covers fallback waiting: `progress.test.ts` pins the
    // predicate (a boundary is outside the narrow disposal scope). The runtime
    // half of that check used the retired `lost-fallback-wake` fault; on L2 a
    // reset's release is structural and no single mechanism can be removed
    // to keep a shown fallback beside unpublished writes (cli.mjs).
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}, 20000);
