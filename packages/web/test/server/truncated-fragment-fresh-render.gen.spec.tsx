/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/truncated-fragment-fresh-render.spec.tsx:
 * renders the fixture and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import { createTruncatedFragmentApp } from "../harness/truncated-fragment-fresh-render.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

test("render truncated-fragment-fresh-render chunks", async () => {
  const { App } = createTruncatedFragmentApp();
  const { shell, chunks } = await recordStream(() => <App />);
  expect(shell.replace(/<[^>]*>/g, "")).toContain("[A][B][C]");
  // The cut lands after the first chunk: it settles `b:fast` and `c:bad`
  // and swaps no fragment in. Every fragment swaps in a later chunk.
  const [first, ...later] = chunks;
  expect(first).toContain('"b:fast"');
  expect(first).toContain("c:bad failed");
  expect(first).not.toContain("$df(");
  for (const id of ["1", "2", "3"]) expect(later.join("")).toContain(`$df("${id}")`);
  writeArtifact("truncated-fragment-fresh-render", { shell, chunks });
});
