/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4374: a nested `<Errored>` the server drew as its fallback inside a
 * streamed `<Loading>`. Whether the client hydrates after the fragment
 * arrived (`loaded`) or boots mid-stream and claims it when it arrives
 * (`streamed`), the page shows the server's fallback once, keeps it with
 * no ask, and recovers with the content when `a`'s input changes. The
 * cause is the hole's, not the boundaries': a string fallback's region is
 * re-claimed after the swap (`text after an element`). Replays
 * the chunks test/server/errored-midstream-4374.gen.spec.tsx renders.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  createTextAfterElementApp,
  createNestedErroredApp,
  nestedErroredName,
  nestedErroredShapes
} from "../harness/errored-midstream-4374.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

const load = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../harness/__artifacts__/${name}.json`),
      "utf-8"
    )
  ) as { shell: string; chunks: string[] };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(10);
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

afterEach(async () => {
  await sleep(0);
  delete (globalThis as any)._$HY;
});

const texts = (el: Element) =>
  [...el.childNodes].filter((n): n is Text => n.nodeType === 3 && !!(n as Text).data);

type App = { App: () => any; write: (v: number) => void; asks: () => number };

/**
 * Hydrates `name`'s chunks (`streamed`: the shell, then each chunk once the
 * client booted) and checks the screen: `served` once, on the server's own
 * text nodes, with nothing asked; then `a`'s input changes and the region
 * shows `recovered`.
 */
async function run(
  name: string,
  app: App,
  mode: "loaded" | "streamed",
  served: string,
  recovered: string
) {
  const { shell, chunks } = load(name);
  bootstrapHydrationGlobal();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { App, write, asks } = app;
  const main = () => container.querySelector("main")!;
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") for (const c of chunks) applyChunk(container, c, false);
    let serverTexts = texts(main());
    dispose = hydrate(() => <App />, container);
    await settle();
    if (mode === "streamed") {
      expect(main().textContent).toBe("[LOAD]");
      for (const c of chunks) applyChunk(container, c, false);
      // The fragment swapped in: the server's text, before the resume.
      serverTexts = texts(main());
      await settle();
    }
    // The server's text, once, on its own nodes; nothing asked.
    expect(main().textContent).toBe(served);
    const now = texts(main());
    expect(now.length).toBe(serverTexts.length);
    now.forEach((n, i) => expect(n).toBe(serverTexts[i]));
    expect(asks()).toBe(0);
    await settle();
    expect(main().textContent).toBe(served);
    expect(asks()).toBe(0);

    // The content's input changes: the region shows the client's content.
    write(2);
    await settle();
    expect(main().textContent).toBe(recovered);
    expect(asks()).toBe(1);
    const diagnostics = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
    expect(diagnostics).toEqual([]);
  } finally {
    dispose?.();
    container.remove();
    warn.mockRestore();
    error.mockRestore();
  }
}

describe("#4374: a nested Errored's served fallback, hydrated", () => {
  for (const o of nestedErroredShapes) {
    const name = nestedErroredName(o);
    for (const mode of ["loaded", "streamed"] as const)
      test(`${name}: ${mode}`, () =>
        run(name, createNestedErroredApp(o), mode, "[INNER]sib", "2sib"));
  }
});

// The cause, without an Errored: a `<Loading>` whose fallback is a string,
// sole content of its parent, claims the fragment its swap put there (#4374:
// the hole kept the fallback's text as a raw string, never re-claimed the
// swapped region, and inserted its content's text beside the server's).
describe("#4374: a string fallback's region, claimed after the swap", () => {
  for (const mode of ["loaded", "streamed"] as const)
    test(`text after an element: ${mode}`, () =>
      run(
        "errored-midstream-4374-text-after-element",
        createTextAfterElementApp(),
        mode,
        "siba1",
        "siba2"
      ));
});
