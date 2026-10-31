import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.js";

// Exercise retention with controlled findings: this test needs no Solid bug.
test.each([false, true])("all findings remain replayable when distinct=%s", async distinct => {
  const dir = await mkdtemp(join(tmpdir(), "solid-fuzz-report-"));
  const workerFile = join(dir, "worker.mjs");
  const exitCode = process.exitCode;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await writeFile(
    workerFile,
    `import { parentPort } from 'node:worker_threads';
    parentPort.on('message', ({ scenario }) => parentPort.postMessage({
      scenario, status: 'fail', failure: { rule: 'test', message: ${distinct ? "JSON.stringify(scenario)" : "'same symptom'"} },
      frames: [], requirements: [], work: [], coverage: [], events: [],
      metrics: { operations: 0, requests: 0, skipped: 0, frames: 0, elapsedMs: 0 }
    }));`
  );
  const context = { workerFile, workerHash: "fixture", sourceHash: "fixture" };
  try {
    await main({ ...context, args: ["--cases", "25", "--out", join(dir, "run")] });
    const lines = (await readFile(join(dir, "run", "findings.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(25);
    const entries = lines.map(line => JSON.parse(line));
    expect(entries.map(e => e.index)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    const reports = (await readdir(join(dir, "run"))).filter(f => /^case-\d+\.json$/.test(f));
    expect(reports.length).toBe(distinct ? 20 : 1);
    await main({
      ...context,
      args: [
        "--replay",
        join(dir, "run", "findings.jsonl"),
        "--index",
        "24",
        "--out",
        join(dir, "replay")
      ]
    });
    const replay = JSON.parse(await readFile(join(dir, "replay", "case-0.json"), "utf8"));
    expect(replay.scenario).toEqual(entries[24].scenario);
  } finally {
    process.exitCode = exitCode;
    log.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("idle worker failure saves the original input and reports an incomplete campaign", async () => {
  const { Client, WorkerFailure } = await import("./client.js");
  const { chain } = await import("./fixtures.js");
  const dir = await mkdtemp(join(tmpdir(), "solid-fuzz-idle-report-"));
  const previous = chain("manual");
  const result = {
    scenario: previous,
    status: "error" as const,
    error: "late fixture failure",
    frames: [],
    requirements: [],
    work: [],
    coverage: [],
    events: [],
    metrics: { operations: 0, requests: 0, skipped: 0, frames: 0, elapsedMs: 0 }
  };
  const run = vi.spyOn(Client.prototype, "run").mockRejectedValue(new WorkerFailure(result));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const exitCode = process.exitCode;
  try {
    await main({
      workerFile: "unused",
      workerHash: "fixture",
      sourceHash: "fixture",
      args: ["--cases", "2", "--out", dir]
    });
    const saved = JSON.parse(await readFile(join(dir, "worker-error.json"), "utf8"));
    expect(saved.scenario).toEqual(previous);
    const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8"));
    expect(summary.workerErrors).toBe(1);
    expect(summary.total).toBe(0);
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = exitCode;
    run.mockRestore();
    log.mockRestore();
    error.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("bounded reduction retains originals and charges final replay separately", async () => {
  const { Client } = await import("./client.js");
  const { chain } = await import("./fixtures.js");
  const { runScenario } = await import("./runner.js");
  const baseline = await runScenario(chain("sync"));
  const dir = await mkdtemp(join(tmpdir(), "solid-fuzz-selection-"));
  const exitCode = process.exitCode;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  let calls = 0;
  const run = vi.spyOn(Client.prototype, "run").mockImplementation(async scenario => {
    calls++;
    return { ...baseline, scenario, status: "fail", failure: { rule: "S1", message: "fixture" } };
  });
  try {
    await main({
      workerFile: "unused",
      workerHash: "fixture",
      sourceHash: "fixture",
      args: ["--cases", "25", "--shrink", "--budget", "0", "--out", dir]
    });
    const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8"));
    const records = JSON.parse(await readFile(join(dir, "reductions.json"), "utf8"));
    expect(summary.retainedCases).toBe(25);
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThanOrEqual(2);
    expect(summary.reductionExecutions).toEqual({
      initial: 0,
      search: 0,
      verification: records.length
    });
    expect(calls).toBe(25 + records.length);
    for (const entry of records) {
      const artifact = JSON.parse(
        await readFile(join(dir, `case-${entry.index}-min.json`), "utf8")
      );
      expect(artifact.reproKey).toBe(entry.reproKey);
      expect(artifact.executionCounts.verification).toBe(1);
    }
  } finally {
    process.exitCode = exitCode;
    log.mockRestore();
    run.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
