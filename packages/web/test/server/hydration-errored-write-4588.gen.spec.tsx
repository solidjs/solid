/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/hydration-errored-write-4588.spec.tsx: renders
 * the app and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import {
  createErroredWriteApp,
  erroredWriteName,
  erroredWriteShapes
} from "../harness/hydration-errored-write-4588.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

for (const o of erroredWriteShapes) {
  const name = erroredWriteName(o);
  test(`render ${name} chunks`, async () => {
    const { App } = createErroredWriteApp(o);
    const { shell, chunks } = await recordStream(() => <App />);
    expect(shell).toContain("F0");
    expect(chunks.join("")).toContain("err:0");
    writeArtifact(name, { shell, chunks });
  });
}
