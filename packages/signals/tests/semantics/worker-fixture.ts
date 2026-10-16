import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "./client.js";

/** Generated cases may halt Solid or throw out of band. Keep those out of the
 * Vitest process, just as the CLI keeps them out of the campaign coordinator. */
export async function withWorker(test: (client: Client) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "solid-fuzz-fixture-"));
  const file = join(dir, "worker.mjs");
  const client = new Client(file);
  try {
    await build({
      entryPoints: [fileURLToPath(new URL("./worker.ts", import.meta.url))],
      outfile: file,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      define: { __DEV__: "true", __OBSERVE__: "true", __TEST__: "true" },
      logLevel: "silent"
    });
    await test(client);
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
    client.checkHealth();
  }
}
