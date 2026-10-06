import { parentPort } from "node:worker_threads";
import { runScenario } from "./runner.js";
import { isMountCase } from "./mount-cases.js";
import { runMountCase } from "./mount-hold.js";

parentPort!.on("message", async ({ scenario, options }) => {
  const result = isMountCase(scenario)
    ? await runMountCase(scenario)
    : await runScenario(scenario, options);
  result.metrics.heapUsedBytes = process.memoryUsage().heapUsed;
  parentPort!.postMessage(result);
});
