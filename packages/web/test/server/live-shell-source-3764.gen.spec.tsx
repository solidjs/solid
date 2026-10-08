/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/live-shell-source-3764.spec.tsx.
 */
import { expect, test } from "vitest";
import { A, B, C } from "../harness/live-shell-source-3764.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

async function render(App: () => any) {
  const { shell, chunks } = await recordStream(App);
  return { shell, chunks };
}

test("render #3764 chunks", async () => {
  const a = await render(() => <A liveMs={0} />);
  const b = await render(() => <B liveMs={0} />);
  const c = await render(() => <C liveMs={0} />);
  expect(c.chunks.join("")).toContain("rows: ");
  expect(a.chunks.join("")).toContain("rows: ");
  expect(b.chunks.join("")).toContain("<li");
  writeArtifact("live-shell-source-3764", { a, b, c });
});
