/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/errored-unserializable-hydration-4647.spec.tsx:
 * renders each fixture and writes its shell plus each later chunk. The
 * memo's value fails to serialize after the first flush, so the render
 * completes and the payload rejects its key (maintainer ruling, 2026-11-03).
 */
import { expect, test } from "vitest";
import type { ServerErrorContext } from "@solidjs/web";
import { AppBare, AppInside, AppOutside } from "../harness/errored-unserializable-4647.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const message = (key: string) =>
  `Serialization failed: the hydration value for key \\"${key}\\" could not be serialized on the server`;

for (const [name, App, key] of [
  ["inside", AppInside, "400000"],
  ["outside", AppOutside, "4000"],
  ["bare", AppBare, "4000"]
] as const) {
  test(`render errored-unserializable-4647-${name} chunks`, async () => {
    const heard: string[] = [];
    let completed = false;
    const { shell, chunks, rest } = await recordStream(() => <App />, {
      onError: (_: unknown, c: ServerErrorContext) => void heard.push(`${c.kind}/${c.handling}`),
      onCompleteAll: () => void (completed = true)
    });
    expect(completed).toBe(true);
    expect(heard).toEqual(["render/serialize"]);
    expect(shell).toMatch(/<span[^>]* class="ok">fine<\/span>/);
    expect(shell).toContain('class="loading"');
    expect(rest).toContain("server value");
    expect(rest).toContain(message(key));
    writeArtifact(`errored-unserializable-4647-${name}`, { shell, chunks });
  });
}
