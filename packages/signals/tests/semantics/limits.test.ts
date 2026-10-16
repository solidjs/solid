import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "./client.js";
import { chain } from "./fixtures.js";

let directory: string;
let client: Client;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "solid-fuzz-limits-"));
  const outfile = join(directory, "worker.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./worker.ts", import.meta.url))],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    define: { __DEV__: "true", __OBSERVE__: "true", __TEST__: "true" }
  });
  client = new Client(outfile);
});
afterAll(async () => {
  await client?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("exactly the allowed number of completion rounds is sufficient", async () => {
  const r = await client.run(chain(), { maxRounds: 1 });
  expect(r.status, JSON.stringify(r)).toBe("pass");
});

test("exactly the allowed number of residual completions is sufficient", async () => {
  const s = chain();
  s.turns = [1, 2, 3].map(value => ({ steps: [{ op: "write", value }] }));
  s.turns.push({ steps: [{ op: "resolve", node: 0, which: "newest" }] });
  const r = await client.run(s, { maxRounds: 2 });
  expect(r.status, JSON.stringify(r)).toBe("pass");
});

test.each(["microtask", "promise", "await"] as const)(
  "invalid %s resolve keeps its status and trace",
  async via => {
    const s = chain();
    s.strict = true;
    s.turns = [
      {
        steps: [
          {
            op: "queue",
            id: 0,
            via,
            step: {
              op: "resolve",
              node: 0,
              which: "newest",
              key: "nonexistent"
            }
          }
        ]
      }
    ];
    const r = await client.run(s);
    expect(r.status, JSON.stringify(r)).toBe("invalid");
    expect(r.frames.length).toBeGreaterThan(0);
    expect(r.error).toContain("nonexistent");
  }
);

test("work exhaustion during a scheduled flush stays a limit, not a runtime crash", async () => {
  const r = await client.run(chain(), { maxWork: 1 });
  expect(r.status, JSON.stringify(r)).toBe("limit");
  expect(r.frames.length).toBeGreaterThan(0);
  expect(r.error).toContain("async work");
});

test("exhaustion at the final checkpoint cannot escape as a pass", async () => {
  const s = chain("sync");
  s.turns = [];
  const r = await client.run(s, { maxFrames: 1 });
  expect(r.status, JSON.stringify(r)).toBe("limit");
  expect(r.frames).toHaveLength(1);
});

test("insufficient rounds are still a limit and cleanup does not overwrite it", async () => {
  const s = chain();
  s.nodes[1].delivery = "manual";
  const r = await client.run(s, { maxRounds: 1 });
  expect(r.status, JSON.stringify(r)).toBe("limit");
  expect(r.work.some(w => w.state === "waiting")).toBe(true);
  expect((await client.run(chain())).status).toBe("pass");
});

test("teardown leaves the stopped work ledger intact", async () => {
  const result = await client.run(chain(), { maxRounds: 0 });
  expect(result.status).toBe("limit");
  expect(result.work).toHaveLength(1);
  expect(result.work[0].state).toBe("waiting");
  expect(result.events).toEqual(["setup: start 0:[0]#1"]);
  expect((await client.run(chain())).status).toBe("pass");
});
