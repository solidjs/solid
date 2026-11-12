/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/errored-contained-hydration-4709.spec.tsx:
 * renders the fixture with an error the default serializer cannot encode,
 * and with one it can, and writes each shell. An `<Errored>` contained the
 * rejection before the first flush, so the render completes with the
 * fallback either way.
 */
import { expect, test } from "vitest";
import type { ServerErrorContext } from "@solidjs/web";
import { App, env } from "../harness/errored-contained-4709.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

for (const [name, encodes, heard] of [
  ["plain", false, ["render/fallback", "render/serialize"]],
  ["encoded", true, ["render/fallback"]]
] as const) {
  test(`render errored-contained-4709-${name} chunks`, async () => {
    env.encodes = encodes;
    const hook: string[] = [];
    let completed = false;
    const { shell, chunks } = await recordStream(() => <App />, {
      onError: (_: unknown, c: ServerErrorContext) => void hook.push(`${c.kind}/${c.handling}`),
      onCompleteAll: () => void (completed = true)
    });
    expect(completed).toBe(true);
    expect([...hook].sort()).toEqual(heard);
    expect(shell).toMatch(/<p[^>]* class="fb">x<\/p>/);
    expect(shell).not.toContain('class="content"');
    writeArtifact(`errored-contained-4709-${name}`, { shell, chunks });
  });
}
