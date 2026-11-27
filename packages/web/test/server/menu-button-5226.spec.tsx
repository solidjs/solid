/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the #5226 menu-button document pair. Renders the
 * menu-button chain from test/harness/scenarios.tsx inside the document
 * shell the vite plugin's `start` mode renders (a hydratable full
 * document), once per focus-primitive allocation shape, and writes the
 * artifacts test/hydration/menu-button-5226.spec.tsx replays with
 * document.write() and hydrates at the document root.
 *
 * The two shapes differ by exactly the three allocations the gated shape
 * skips on the server (the onSettled tracked effect and the two
 * event-listener effects): the aligned shape's menu-button keys sit three
 * slots past the gated one's in the enclosing id scope, and the client
 * matches whichever shape it runs.
 */
import { describe, expect, test } from "vitest";
import {
  MenuButtonChain,
  MenuButtonChainAligned,
  MenuButtonDocument
} from "../harness/scenarios.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

function docTree(App: () => unknown) {
  return () => (
    <MenuButtonDocument>
      <App />
    </MenuButtonDocument>
  );
}

async function recordDocument(name: string, App: () => unknown): Promise<string> {
  const { shell, rest } = await recordStream(docTree(App));
  // The document is not streamed in fragments: everything lands in the shell.
  expect(rest).toBe("");
  expect(shell).toContain("<sm-navigation-rail");
  expect(shell).toContain('aria-checked="false"');
  expect(shell).toContain("<button");
  writeArtifact(name, { shell, chunks: [] });
  return shell;
}

describe("#5226 menu-button document render", () => {
  test("gated shape: the document carries the menu-button chain", async () => {
    await recordDocument("menu-button-document-5226", MenuButtonChain);
  });

  test("aligned shape: the same chain with three more server ids before it", async () => {
    const shell = await recordDocument("menu-button-document-aligned-5226", MenuButtonChainAligned);
    const keys = [...shell.matchAll(/_hk=([^" >]+)/g)].map(m => m[1]);
    // The chain's element structure is identical in both shapes; the keys
    // differ because the aligned server consumed the gated shape's three
    // skipped allocations before the menu button's scope.
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys).toContain("0");
  });
});
