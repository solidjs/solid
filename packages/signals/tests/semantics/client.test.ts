import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, WorkerFailure } from "./client.js";
import { chain } from "./fixtures.js";

// A control port lets the fixture fail only after run() has returned.
test.each(["throw", "exit"])(
  "an idle worker %s stays attributed to its previous case",
  async mode => {
    const dir = await mkdtemp(join(tmpdir(), "solid-fuzz-idle-"));
    const file = join(dir, "worker.mjs");
    await writeFile(
      file,
      `import { parentPort, BroadcastChannel } from 'node:worker_threads';
    parentPort.once('message', ({ scenario }) => {
      const channel = new BroadcastChannel(scenario.control);
      channel.onmessage = () => {
        if (${JSON.stringify(mode)} === 'throw') throw new Error('late fixture failure');
        process.exit(7);
      };
      parentPort.postMessage({ status: 'pass' });
    });`
    );
    const { BroadcastChannel } = await import("node:worker_threads");
    const control = new BroadcastChannel(dir);
    const client = new Client(file);
    const previous = Object.assign(chain(), { control: dir });
    try {
      expect((await client.run(previous)).status).toBe("pass");
      control.postMessage("fail now");
      await vi.waitFor(() => expect(() => client.checkHealth()).toThrow(WorkerFailure));
      try {
        await client.run(chain("sync"));
        throw new Error("Expected idle failure");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkerFailure);
        expect((error as WorkerFailure).result.scenario).toBe(previous);
        expect((error as WorkerFailure).result.error).toContain(
          mode === "throw" ? "late fixture failure" : "(7)"
        );
      }
    } finally {
      control.close();
      await client.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);
