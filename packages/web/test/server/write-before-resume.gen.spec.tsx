/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/write-before-resume.spec.tsx: renders the
 * page and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import { createSharedApp } from "../harness/write-before-resume.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

test("render write-before-resume chunks", async () => {
  const { App } = createSharedApp();
  const { shell, chunks } = await recordStream(() => <App />);
  expect(shell).toContain("side-loading");
  // Both boundaries' 60 ms sources are due at the same instant: one chunk,
  // `<Side>` (created first) ahead of `<SyncSide>`, on every host.
  expect(chunks).toHaveLength(1);
  expect(chunks[0].indexOf("data:/a")).toBeGreaterThan(-1);
  expect(chunks[0].indexOf("sync:/a")).toBeGreaterThan(chunks[0].indexOf("data:/a"));
  writeArtifact("write-before-resume", { shell, chunks });
});
