/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/errored-deferstream-rejection-4747.spec.tsx:
 * renders each fixture and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import { AppDeferred, AppStreamed } from "../harness/errored-deferstream-rejection-4747.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

for (const [name, App] of [
  ["streamed", AppStreamed],
  ["deferred", AppDeferred]
] as const) {
  test(`render errored-deferstream-rejection-4747-${name} chunks`, async () => {
    let completed = false;
    const { shell, chunks } = await recordStream(() => <App />, {
      onError: () => {},
      onCompleteAll: () => void (completed = true)
    });
    expect(completed).toBe(true);
    expect(shell + chunks.join("")).toContain('class="fb"');
    writeArtifact(`errored-deferstream-rejection-4747-${name}`, { shell, chunks });
  });
}
