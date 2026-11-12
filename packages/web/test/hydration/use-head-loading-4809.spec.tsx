/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Hydrate half of #4809 (see test/harness/use-head-loading-4809.tsx): replays
 * the shell, hydrates, then streams the fragment. Before the fix the memo had
 * no record, so the resumed content suspended again and the boundary built a
 * fresh fallback at a key the server never rendered ("010").
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { app, expected, variants, type Variant } from "../harness/use-head-loading-4809.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadArtifact(variant: Variant): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `use-head-loading-4809-${variant}.json`);
  if (!existsSync(file)) {
    throw new Error(
      "Missing artifact. Run the server harness first: " +
        "vitest run --config vite.config.server.mjs test/server/use-head-loading-4809.spec.tsx"
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  delete (globalThis as any)._$HY;
  delete (globalThis as any).$R;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("#4809 useHead under Loading — hydration", () => {
  for (const variant of Object.keys(variants) as Variant[]) {
    test(`${variant}: the resumed content claims the fragment without a fallback rebuild`, async () => {
      const { shell, rest } = loadArtifact(variant);
      const logs: string[] = [];
      for (const level of ["warn", "error"] as const)
        vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
          logs.push(a.map(String).join(" "));
        });
      const container = document.createElement("div");
      document.body.appendChild(container);
      bootstrapHydrationGlobal();
      applyChunk(container, shell, true);

      const App = app(variant);
      dispose = hydrate(() => <App />, container);
      flush();
      await sleep(5);
      applyChunk(container, rest, false);
      await sleep(40);
      flush();

      expect(logs).toEqual([]);
      expect((globalThis as any)._$HY.done).toBe(true);
      expect(container.querySelector("main")?.textContent).toBe("content");
      expect(container.querySelector("p")).toBeNull();
      expect(container.querySelector("span")?.textContent).toBe(expected[variant].span);
      expect(document.title).toBe("Async Title");
    });
  }
});
