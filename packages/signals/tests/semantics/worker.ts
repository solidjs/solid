import { parentPort } from "node:worker_threads";
import { runScenario } from "./runner.js";

parentPort!.on("message", async ({ scenario, options }) => {
  const result = await runScenario(scenario, options);
  result.metrics.heapUsedBytes = process.memoryUsage().heapUsed;
  parentPort!.postMessage(result);
});
