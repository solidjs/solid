/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4807: when the client hydrates mid-stream, a's fragment swap takes a
 * middle node of the parent hole's tracked region. The hole re-claims the
 * live region instead of diffing against the detached node, which used to
 * move a's content inside b's placeholder range, where b's swap removed it.
 * Replays the chunks test/server/sibling-loading-4807.gen.spec.tsx renders.
 */
import { afterEach, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { createSiblingLoadingApp, parents } from "../harness/sibling-loading-4807.jsx";
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

for (const parent of parents)
  for (const mode of ["loaded", "streamed"] as const)
    test(`sibling Loading boundaries under ${parent}: ${mode}`, async () => {
      const { shell, chunks } = load(`sibling-loading-4807-${parent}`);
      bootstrapHydrationGlobal();
      const container = document.body.appendChild(document.createElement("div"));
      const { App } = createSiblingLoadingApp(parent);
      const tail = parent === "show-tail" ? "tail" : "";
      const lead = parent === "lead-show" ? "lead" : "";
      const text = () => container.querySelector("main")!.textContent;
      applyChunk(container, shell, true);
      if (mode === "loaded") for (const c of chunks) applyChunk(container, c, false);
      const dispose = hydrate(() => <App />, container);
      await settle();
      if (mode === "streamed") {
        expect(text()).toBe(`${lead}headloading aloading b${tail}`);
        applyChunk(container, chunks[0], false);
        await settle();
        expect(text()).toBe(`${lead}heada 1loading b${tail}`);
        applyChunk(container, chunks[1], false);
        await settle();
      }
      await sleep(100);
      await settle();
      expect(text()).toBe(`${lead}heada 1b 2${tail}`);
      dispose();
      container.remove();
    });
