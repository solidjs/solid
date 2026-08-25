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
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { App, AsyncApp, computeRuns, APP_ROOT_MARKUP } from "../harness/document-shell.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Apply a server chunk the way a streaming browser parse would: markup into
// the DOM, inline scripts evaluated (they populate _$HY.r).
function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

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

  test("async island: serialized reactive values adopt by id under the island namespace", async () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { chunks } = JSON.parse(
      readFileSync(resolve(artifactsDir, "document-shell-async.json"), "utf-8")
    ) as { chunks: string[] };

    const container = document.createElement("div");
    document.body.appendChild(container);
    chunks.forEach((c, i) => applyChunk(container, c, i === 0));

    const root = container.querySelector("#app-root") as HTMLElement;
    const serverSpan = root.querySelector("#data");
    const serverButton = root.querySelector("#bump") as HTMLElement;

    computeRuns.client = 0;
    const dispose = hydrate(() => <AsyncApp />, root);
    flush();
    await sleep(30);
    flush();
    await sleep(30);
    flush();

    // Claimed, and the serialized async record was adopted BY ID: the DOM
    // shows the server's value (the client compute would produce
    // "client-data") and the compute never ran. This is what breaks when
    // only element keys — not reactive ids — share the namespace.
    expect(root.querySelector("#data")).toBe(serverSpan);
    expect(root.querySelector("#data")!.textContent).toBe("server-data");
    expect(computeRuns.client).toBe(0);

    serverButton.click();
    flush();
    expect(root.querySelector("#bump")!.textContent).toBe("n: 1");

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    dispose();
    container.remove();
  });
});
