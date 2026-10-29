/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/errored-pending-reask-4375.spec.tsx: renders
 * each shape and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import {
  createPendingReaskApp,
  pendingReaskName,
  pendingReaskShapes
} from "../harness/errored-pending-reask-4375.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

for (const o of pendingReaskShapes) {
  const name = pendingReaskName(o);
  test(`render ${name} chunks`, async () => {
    const { App } = createPendingReaskApp(o);
    const { shell, chunks } = await recordStream(() => <App />);
    expect(shell).toContain("[ROOT-L]");
    const rest = chunks.join("");
    expect(rest).toContain("m0:3");
    writeArtifact(name, { shell, chunks });
  });
}
