/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #2936: a reactive text hole inside a streamed <Loading> FALLBACK must claim
 * the server-rendered text between the placeholder <template id="pl-X"> and
 * its <!--pl-X--> end marker, and replace it in place on updates that land
 * while the boundary is still pending. The reported failure appended a fresh
 * text node after the claimed one on every update ("0" then "01", "012", …)
 * and never removed the original.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios, bumpPendingFallback } from "../harness/scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file)) throw new Error(`Missing artifact "${name}" — run the server harness.`);
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

describe("#2936 — fallback updates while the boundary is pending", () => {
  const scenario = scenarios.find(s => s.name === "loading-fallback-reactive-text")!;
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    container.innerHTML = "";
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  test("reactive fallback text replaces in place, then resolves cleanly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { shell, rest } = loadArtifact(scenario.name);

    applyChunk(container, shell, true);
    expect(container.textContent).toBe("head 0");

    dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(5);
    flush();

    // Boundary still pending — the fallback is live. Every update must
    // REPLACE the text in place.
    bumpPendingFallback();
    flush();
    console.log("after bump 1:", JSON.stringify(container.textContent));
    bumpPendingFallback();
    flush();
    console.log("after bump 2:", JSON.stringify(container.textContent));
    expect(container.textContent).toBe("head 2");

    // Stream the resolution — fallback (including updated text) must clear.
    applyChunk(container, rest, false);
    await sleep(30);
    flush();
    console.log("after resolve:", JSON.stringify(container.textContent));
    expect(container.textContent).toBe("head done");

    const bad = warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed")
    );
    expect(bad).toHaveLength(0);
    warn.mockRestore();
  });
});
