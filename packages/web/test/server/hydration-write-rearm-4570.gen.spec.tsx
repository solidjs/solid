/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/hydration-write-rearm-4570.spec.tsx: renders
 * the app and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import {
  createWriteRearmApp,
  writeRearmName,
  writeRearmShapes
} from "../harness/hydration-write-rearm-4570.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

for (const o of writeRearmShapes) {
  const name = writeRearmName(o);
  test(`render ${name} chunks`, async () => {
    const { App } = createWriteRearmApp(o);
    const { shell, chunks } = await recordStream(() => <App />);
    expect(shell).toContain("F0");
    expect(chunks.join("")).toContain("a1=");
    writeArtifact(name, { shell, chunks });
  });
}
