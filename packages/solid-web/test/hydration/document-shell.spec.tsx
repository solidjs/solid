/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Client half of the document-shell pattern tests (#3000) — see
 * test/harness/document-shell.tsx. The server rendered the full document
 * with the shell under <NoHydration> and the app re-entered via <Hydration>;
 * the client hydrates only the app subtree into #app-root. Everything must
 * wire up live: nodes claimed, events firing, effects updating the DOM.
 *
 * The markup is pinned by test/server/document-shell.spec.tsx against the
 * same shared source, so this cannot drift from real server output.
 */
import { describe, expect, test, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { App, APP_ROOT_MARKUP } from "../harness/document-shell.jsx";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("document-shell pattern — client hydrate (#3000)", () => {
  test("hydrating the island subtree claims nodes and stays reactive", async () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML = `<div id="app-root">${APP_ROOT_MARKUP}</div>`;
    const root = document.getElementById("app-root")!;
    const serverButton = document.getElementById("counter")!;

    const dispose = hydrate(() => <App />, root);
    flush();
    await sleep(20);
    flush();

    // Claimed, not recreated.
    expect(document.getElementById("counter")).toBe(serverButton);

    // The hydrated effects are live: a delegated click updates the claimed
    // node (#3000's symptom was this staying frozen at "count: 0").
    serverButton.click();
    flush();
    expect(root.textContent).toBe("count: 1");
    serverButton.click();
    flush();
    expect(root.textContent).toBe("count: 2");

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    dispose();
  });
});
