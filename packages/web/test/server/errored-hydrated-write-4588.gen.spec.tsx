/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/errored-hydrated-write-before-chunks-4588.spec.tsx:
 * renders each shape and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import {
  createHydratedWriteApp,
  hydratedWriteName,
  hydratedWriteShapes
} from "../harness/errored-hydrated-write-4588.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

for (const o of hydratedWriteShapes) {
  const name = hydratedWriteName(o);
  test(`render ${name} chunks`, async () => {
    const { App } = createHydratedWriteApp(o);
    const { shell, chunks } = await recordStream(() => <App />);
    expect(shell).toContain("[LOAD]");
    if (o.place === "shell") expect(shell).toContain("[ERR]");
    else if (o.place === "streamed") expect(chunks.join("")).toContain("[ERR]");
    writeArtifact(name, { shell, chunks });
  });
}
