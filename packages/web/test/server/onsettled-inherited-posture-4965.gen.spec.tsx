/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/onsettled-inherited-posture-4965.spec.tsx.
 */
import { expect, test } from "vitest";
import { App } from "../harness/onsettled-inherited-posture-4965.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

test("onsettled-inherited-posture-4965: renders the live answers", async () => {
  const rec = await recordStream(() => <App />);
  const html = rec.shell + rec.rest;
  expect(html).toContain('<p id="hydrated">no</p>');
  expect(html).toContain("free");
  writeArtifact("onsettled-inherited-posture-4965", { shell: rec.shell, chunks: rec.chunks });
});
