/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/claim-stale-text.spec.tsx: renders the page
 * and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import { createPendingApp, createSharedApp } from "../harness/claim-stale-text.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

test("render claim-stale-text chunks", async () => {
  const { App } = createSharedApp();
  const { shell, chunks } = await recordStream(() => <App />);
  expect(shell).toContain("loading");
  expect(shell).toContain("async:k");
  const rest = chunks.join("");
  expect(rest).toContain("raw:k");
  expect(rest).toContain("sync:k");
  expect(rest).toContain("only:k");
  writeArtifact("claim-stale-text", { shell, chunks });
});

test("render claim-stale-text-pending chunks", async () => {
  const { App } = createPendingApp();
  const { shell, chunks } = await recordStream(() => <App />);
  expect(shell).toContain("loading");
  expect(shell).not.toContain("slow:k");
  expect(chunks.join("")).toContain("chained:slow:k");
  writeArtifact("claim-stale-text-pending", { shell, chunks });
});
