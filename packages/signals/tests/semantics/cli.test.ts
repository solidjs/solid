import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./cli.js";

test("calibration cannot succeed merely because the worker crashes", async () => {
  const out = await mkdtemp(join(tmpdir(), "solid-fuzz-broken-worker-"));
  const workerFile = join(out, "broken.mjs");
  await writeFile(workerFile, 'throw new Error("Worker setup failed");');
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await expect(
      main({
        args: ["--calibrate", "--out", out],
        workerFile,
        fault: "drop-wake",
        sourceHash: "test",
        workerHash: "test"
      })
    ).rejects.toThrow(/Calibration.*(error|inconclusive)/);
  } finally {
    log.mockRestore();
    await rm(out, { recursive: true, force: true });
  }
});
