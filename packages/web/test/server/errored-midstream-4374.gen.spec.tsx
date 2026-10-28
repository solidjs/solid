/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/errored-midstream-4374.spec.tsx: renders
 * each shape and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import {
  createTextAfterElementApp,
  createNestedErroredApp,
  nestedErroredName,
  nestedErroredShapes
} from "../harness/errored-midstream-4374.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

for (const o of nestedErroredShapes) {
  const name = nestedErroredName(o);
  test(`render ${name} chunks`, async () => {
    const { App } = createNestedErroredApp(o);
    const { shell, chunks } = await recordStream(() => <App />);
    expect(shell).toContain("[LOAD]");
    const rest = chunks.join("");
    expect(rest).toContain("[INNER]");
    expect(rest).not.toContain("[OUTER]");
    expect(rest).not.toContain("[ROOT]");
    writeArtifact(name, { shell, chunks });
  });
}

test("render errored-midstream-4374-text-after-element chunks", async () => {
  const { App } = createTextAfterElementApp();
  const { shell, chunks } = await recordStream(() => <App />);
  expect(shell).toContain("[LOAD]");
  expect(chunks.join("")).toContain("<i _hk=");
  writeArtifact("errored-midstream-4374-text-after-element", { shell, chunks });
});
