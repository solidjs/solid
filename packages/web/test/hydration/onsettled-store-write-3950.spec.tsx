/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * solidjs/solid#3950: a store write from `onSettled` while hydration still
 * holds the snapshot scope removes a row a hydrated `<For>` claimed. The
 * list must end on the client value with the removed row gone, with no
 * hydration key miss and no halted reactivity. Replays the chunks
 * test/server/onsettled-store-write-3950.gen.spec.tsx renders.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { variants } from "../harness/onsettled-store-write-3950.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

function loadArtifact(name: string): { shell: string; chunks: string[] } {
  return JSON.parse(readFileSync(resolve(artifactsDir, `${name}.json`), "utf-8"));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

describe("store write from onSettled during hydration of a <For> (#3950)", () => {
  for (const variant of variants) {
    test(`${variant.name}: the removed row leaves the claimed list`, async () => {
      const { shell, chunks } = loadArtifact(variant.name);
      (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const container = document.createElement("div");
      document.body.appendChild(container);
      const rows = () => [...container.querySelectorAll("li")].map(li => li.textContent);

      applyChunk(container, shell, true);
      for (const c of chunks) applyChunk(container, c, false);
      expect(rows()).toEqual(["remove", "keep"]);
      const kept = container.querySelectorAll("li")[1];

      const dispose = hydrate(() => <variant.App />, container);
      await vi.waitFor(() => {
        flush();
        expect(rows()).toEqual(["keep"]);
      });
      expect(container.querySelector("li")).toBe(kept);

      const diagnostics = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
      dispose();
      container.remove();
      warn.mockRestore();
      error.mockRestore();
      expect(diagnostics).toEqual([]);
    });
  }
});
