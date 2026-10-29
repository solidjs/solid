/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * A stream cut before its fragments settle (#2958), where each boundary's
 * content creates its own async reads, so the shell carries their records
 * still pending. Each cut fragment renders fresh on the client and adopts
 * what the server sent by id (#4319): `b:fast`'s value, and `c:bad`'s error
 * for the <Errored> in C's content. The reads the server never answered
 * compute: the cut drops their records from the registry before the fresh
 * render reads it, so each slow read asks once and its boundary shows the
 * client's value. The records used to be dropped a macrotask after the
 * fresh render had already adopted their promises, which never settle: the
 * boundaries stayed on their fallbacks and nothing was asked.
 *
 * The complete stream runs first: the ledger's truncation record is module
 * state, and a boundary id it marks stays marked for the rest of the file.
 *
 * Replays the chunks test/server/truncated-fragment-fresh-render.gen.spec.tsx renders.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
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

// The parser finishing: the document transport's close.
function endDocument() {
  Object.defineProperty(document, "readyState", { value: "interactive", configurable: true });
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

type Page = { container: HTMLElement; asks: () => string[]; hy: any; start: () => void };

async function withPage(body: (page: Page) => Promise<void>) {
  const hy = bootstrapHydrationGlobal();
  delete (globalThis as any).$R;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  // The runtime boots while the document is still streaming: the only
  // window where the truncation sweep arms.
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  const { App, asks } = createTruncatedFragmentApp();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    // `body` replays what it needs, then starts hydration.
    await body({ container, asks, hy, start: () => (dispose = hydrate(() => <App />, container)) });
    const diagnostics = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
    expect(diagnostics).toEqual([]);
  } finally {
    dispose?.();
    container.remove();
    warn.mockRestore();
    error.mockRestore();
    delete (document as any).readyState;
  }
}

afterEach(async () => {
  await sleep(0);
  delete (globalThis as any)._$HY;
});

describe("a fragment's fresh render after a truncated stream", () => {
  test("complete stream: every read claims the server's answer, nothing is asked", () =>
    withPage(async page => {
      page.start();
      await settle();
      expect(page.container.textContent).toBe("[A][B][C]");
      for (const chunk of chunks) {
        applyChunk(page.container, chunk, false);
        await settle();
      }
      endDocument();
      await settle();
      expect(page.container.textContent).toBe(SERVER_TEXT);
      expect(page.asks()).toEqual([]);
      expect(page.hy.done).toBe(true);
    }));

  test("cut after the first chunk: what the server sent is adopted, the rest computes", () =>
    withPage(async page => {
      applyChunk(page.container, chunks[0], false);
      page.start();
      await settle();
      expect(page.container.textContent).toBe("[A][B][C]");
      expect(page.asks()).toEqual([]);

      endDocument();
      await settle();
      await settle();

      // Each slow read asks once; `b:fast` and `c:bad` are not asked again.
      expect(page.asks()).toEqual(["a:slow", "b:slow", "c:slow"]);
      // The served value and the served error, beside the client's values.
      expect(page.container.textContent).toBe(SERVER_TEXT);
      expect(page.hy.done).toBe(true);
    }));
});
