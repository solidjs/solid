/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/sibling-loading-4807.spec.tsx.
 */
import { expect, test } from "vitest";
import { createSiblingLoadingApp, parents } from "../harness/sibling-loading-4807.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

for (const parent of parents)
  test(`render sibling-loading-4807-${parent} chunks`, async () => {
    const { App } = createSiblingLoadingApp(parent);
    const { shell, chunks } = await recordStream(() => <App />);
    expect(shell).toContain("loading a");
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("a ");
    expect(chunks[1]).toContain("b ");
    writeArtifact(`sibling-loading-4807-${parent}`, { shell, chunks });
  });
