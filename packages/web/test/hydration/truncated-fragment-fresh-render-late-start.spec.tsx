/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The cut from truncated-fragment-fresh-render.spec.tsx (#4413), with a
 * runtime that boots after the parser finished. Under the in-render
 * bootstrap (`_$HY.s`) the sweep runs at hydrate() instead of at
 * DOMContentLoaded, and it still drops the dead records before any fresh
 * render reads them: each slow read asks once, and what the server sent
 * before the cut is adopted. Separate file because the ledger's truncation
 * record is module state.
 *
 * Replays the chunks test/server/truncated-fragment-fresh-render.gen.spec.tsx renders.
 */
import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { createTruncatedFragmentApp } from "../harness/truncated-fragment-fresh-render.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

const { shell, chunks } = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../harness/__artifacts__/truncated-fragment-fresh-render.json"
    ),
    "utf-8"
  )
) as { shell: string; chunks: string[] };

const SERVER_TEXT = "a:slowb:fastb:slowc:bad failedc:slow";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(15);
    flush();
  }
}

function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

test("cut after the first chunk, late boot: what the server sent is adopted, the rest computes", async () => {
  const hy = bootstrapHydrationGlobal();
  // The in-render bootstrap declares the shell-end ledger, and the shell's
  // marker has run: the whole shell parsed, then the connection dropped.
  hy.s = { "": 1 };
  delete (globalThis as any).$R;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { App, asks } = createTruncatedFragmentApp();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    applyChunk(container, chunks[0], false);
    // Parsing is over before the entry runs: DOMContentLoaded is behind us.
    Object.defineProperty(document, "readyState", { value: "interactive", configurable: true });

    dispose = hydrate(() => <App />, container);
    await settle();
    await settle();

    // Each slow read asks once; `b:fast` and `c:bad` are not asked again.
    expect(asks()).toEqual(["a:slow", "b:slow", "c:slow"]);
    // The served value and the served error, beside the client's values.
    expect(container.textContent).toBe(SERVER_TEXT);
    expect(hy.done).toBe(true);
    const diagnostics = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
    expect(diagnostics).toEqual([]);
  } finally {
    dispose?.();
    container.remove();
    warn.mockRestore();
    error.mockRestore();
    delete (document as any).readyState;
    await sleep(0);
    delete (globalThis as any)._$HY;
  }
});
