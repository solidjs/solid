/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * `createDeferred` through SSR and hydration (docs/create-deferred.md D5,
 * D7): the server renders it as the memo it wraps, the client claims the
 * server-rendered content as commit #0 (the parity harness pins the claim
 * over the same artifact — scenario "deferred-settled-element"), and the
 * first refetch after hydration is already clamped: the claimed DOM keeps the
 * adopted answer while the flight is up, and swaps at the landing. The
 * `createMemo` twin (scenario "async-settled-element") would hold the
 * update and show the new value only at the landing too — what differs is
 * invisible to a textContent check at the end, so this spec reads the DOM
 * MID-flight.
 *
 * Replays the chunk artifact test/server/hydration-harness.spec.tsx writes
 * (loaded mode: the full-page refresh case).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios } from "../harness/scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact for scenario "${name}". Run the server harness first: ` +
        `vitest run --config vite.config.server.mjs test/server/hydration-harness.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

describe("createDeferred hydrates like createMemo and lags on its first refetch", () => {
  test("the adopted answer stays on screen while the refetch flies; the landing swaps it in place", async () => {
    const scenario = scenarios.find(s => s.name === "deferred-settled-element")!;
    const { shell, rest } = loadArtifact(scenario.name);
    const container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let dispose: (() => void) | undefined;
    try {
      applyChunk(container, shell, true);
      if (rest) applyChunk(container, rest, false);
      dispose = hydrate(() => <scenario.App />, container);
      flush();
      await sleep(10);
      flush();
      const div = container.querySelector("div")!;
      expect(div.textContent).toBe("Value: 42");

      // The refetch: the write commits (nothing holds it), the claimed node
      // keeps serving the adopted answer, no fallback.
      scenario.update!();
      flush();
      expect(container.textContent).toBe("Value: 42");
      expect(container.querySelector("p")).toBeNull();

      await sleep(50);
      flush();
      expect(container.textContent).toBe("Value: 43");
      expect(container.querySelector("div"), "the claimed element survives the landing").toBe(div);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      dispose?.();
      container.remove();
    }
  });
});
