import { Worker } from "node:worker_threads";
import type { RunOptions, RunResult } from "./runner.js";
import type { Scenario } from "./scenario.js";

export const workerLimits = { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 };

/** An idle failure belongs to the last submitted case, never the next input. */
export class WorkerFailure extends Error {
  constructor(readonly result: RunResult) {
    super(result.error);
  }
}
interface Slot {
  worker: Worker;
  scenario?: Scenario;
  started: number;
  diagnostics: string;
  closing: boolean;
  failed: boolean;
  finish?: (result: RunResult) => void;
}

/** One outstanding case per worker; the watchdog lives outside its event loop. */
export class Client {
  private slot?: Slot;
  private idleFailure?: RunResult;
  constructor(
    private file: string,
    private timeout = 5000,
    private fresh = false
  ) {}
  checkHealth() {
    if (this.idleFailure) throw new WorkerFailure(this.idleFailure);
  }
  private failure(slot: Slot, status: "error" | "limit", error: string): RunResult {
    return {
      status,
      error,
      scenario: slot.scenario!,
      frames: [],
      requirements: [],
      work: [],
      coverage: [],
      events: [],
      diagnostics: slot.diagnostics || undefined,
      metrics: {
        operations: 0,
        skipped: 0,
        requests: 0,
        frames: 0,
        elapsedMs: performance.now() - slot.started
      }
    };
  }
  private create(): Slot {
    const slot: Slot = {
      worker: new Worker(this.file, { stderr: true, stdout: true, resourceLimits: workerLimits }),
      started: 0,
      diagnostics: "",
      closing: false,
      failed: false
    };
    const capture = (chunk: Buffer) => {
      slot.diagnostics = (slot.diagnostics + chunk.toString()).slice(-4096);
    };
    slot.worker.stderr.on("data", capture);
    slot.worker.stdout.on("data", capture);
    const fail = (status: "error" | "limit", error: string) => {
      if (slot.failed) return;
      slot.failed = true;
      const result = this.failure(slot, status, error);
      if (slot.finish) slot.finish(result);
      else this.idleFailure ??= result;
    };
    // Lifecycle listeners stay installed while idle and during termination.
    slot.worker.on("error", (e: Error & { code?: string }) => {
      fail(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "limit" : "error", e.stack ?? e.message);
    });
    slot.worker.on("exit", code => {
      if (!slot.closing) fail("error", `Worker exited unexpectedly (${code})`);
    });
    return slot;
  }
  async run(scenario: Scenario, options?: RunOptions): Promise<RunResult> {
    this.checkHealth();
    const slot = (this.slot ??= this.create());
    if (slot.finish) throw new Error("Only one case may run per client");
    slot.scenario = scenario;
    slot.diagnostics = "";
    slot.started = performance.now();
    const result = await new Promise<RunResult>(resolve => {
      const finish = (r: RunResult) => {
        clearTimeout(timer);
        slot.worker.off("message", finish);
        slot.finish = undefined;
        slot.scenario = r.scenario ?? slot.scenario;
        if (slot.diagnostics) r.diagnostics = slot.diagnostics;
        resolve(r);
      };
      const timer = setTimeout(
        () => finish(this.failure(slot, "limit", `Host watchdog exceeded ${this.timeout}ms`)),
        this.timeout
      );
      slot.finish = finish;
      slot.worker.once("message", finish);
      try {
        slot.worker.postMessage({ scenario, options });
      } catch (error) {
        finish(this.failure(slot, "error", String(error)));
      }
    });
    if (this.fresh || result.status !== "pass") await this.close();
    this.checkHealth();
    return result;
  }
  async close() {
    const slot = this.slot;
    this.slot = undefined;
    if (slot) {
      slot.closing = true;
      await slot.worker.terminate();
    }
  }
}
