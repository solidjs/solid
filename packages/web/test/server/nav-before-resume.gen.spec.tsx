/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/nav-before-resume.spec.tsx:
 * renders the router-shaped page and writes its shell plus each later chunk.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { expect, test } from "vitest";
import { createNavApp } from "../harness/nav-before-resume.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const storage = new AsyncLocalStorage<any>();
(globalThis as any)[Symbol.for("solid.RequestContext")] = storage;

test("render nav-before-resume chunks", async () => {
  const { App } = createNavApp();
  const event = {
    request: new Request("http://localhost/a"),
    locals: {},
    response: { status: 200, headers: new Headers() }
  };
  const { shell, chunks } = await storage.run(event, () => recordStream(() => <App />));
  const all = shell + chunks.join("");
  expect(shell).toContain("title:/a");
  expect(shell).toContain("side-loading");
  expect(shell).toContain("a-loading");
  expect(all).toContain("a-data");
  expect(all).toContain("side-data");
  expect(all).toContain('"lib:side"');
  // The route's 20 ms boundary, then the 60 ms `<Side>`: two chunks in that
  // order on every host (a loaded loop once found both due and wrote them
  // the other way round).
  expect(chunks).toHaveLength(2);
  expect(chunks[0]).toContain("a-data");
  expect(chunks[1]).toContain("side-data");
  writeArtifact("nav-before-resume", { shell, chunks });
});
