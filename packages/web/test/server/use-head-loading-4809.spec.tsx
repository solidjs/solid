/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of #4809 (see test/harness/use-head-loading-4809.tsx). The head
 * registry's readiness probe suspends the boundary by throwing out of its
 * discovery pass. The retry adopts the async memo's settled slot without
 * serializing it, so the record the first pass buffered must survive the
 * retry, or the client recomputes the memo and the boundary falls back again.
 */
import { describe, expect, test } from "vitest";
import { app, expected, variants, type Variant } from "../harness/use-head-loading-4809.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

describe("#4809 useHead under Loading — server render", () => {
  for (const variant of Object.keys(variants) as Variant[]) {
    test(`${variant}: each async record ships once with the fragment`, async () => {
      const App = app(variant);
      const { shell, rest } = await recordStream(() => <App />);
      const full = shell + rest;
      writeArtifact(`use-head-loading-4809-${variant}`, { shell, rest });

      expect(shell).toContain(">loading</p>");
      expect(rest).toContain('"t","Async Title"');
      const records = [...full.matchAll(/_\$HY\.r\["(\w+)"\]/g)].map(m => m[1]);
      expect(records.filter(id => !id.endsWith("_fr"))).toEqual(expected[variant].records);
    });
  }
});
