/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4287: `<Errored>` around a `<Loading>` whose content reads an async memo
 * that rejects after the shell flushed. The server draws the Errored
 * fallback into the fragment and serializes the error at the Errored id.
 *
 * - Hydrating after the failure arrived, the client adopts the server's
 *   fallback node: no loading fallback, no new ask, and (#4273) it recovers
 *   when the memo's input changes.
 * - Hydrating before it arrived, the client renders the failure itself once
 *   the fragment rejects, with nothing of the server's swap left beside it.
 * - With an async hole in the fallback still pending when the Loading fails,
 *   the server has no fallback markup to draw and serializes no error: the
 *   client renders the failure itself instead of claiming a missing node.
 *
 * Replays the parity harness artifact (test/server/hydration-harness.spec.tsx).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios, postflushClientAskCount } from "../harness/scenarios.jsx";

const artifact = (name: string) =>
  resolve(dirname(fileURLToPath(import.meta.url)), `../harness/__artifacts__/${name}.json`);
const name = "errored-loading-postflush-rejection-4287";
const file = artifact(name);
const scenario = scenarios.find(s => s.name === name)!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

async function run(mode: "loaded" | "streamed") {
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const asksBefore = postflushClientAskCount();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    const serverP = container.querySelector("p");
    dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();
    if (mode === "streamed") {
      expect(container.textContent).toBe("loadingtail");
      applyChunk(container, rest, false);
    }
    await sleep(30);
    flush();
    expect(container.textContent).toBe("failed: no user 7tail");
    expect(container.querySelectorAll("p").length).toBe(1);
    if (mode === "loaded") expect(container.querySelector("p")).toBe(serverP);
    // The server's answer is used: nothing is asked again on the client.
    expect(postflushClientAskCount()).toBe(asksBefore);

    scenario.update!();
    flush();
    await sleep(30);
    flush();
    expect(container.textContent).toBe("user:u8tail");
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

async function runAsyncFallback(mode: "loaded" | "streamed") {
  const name = "errored-loading-postflush-rejection-async-fallback-4287";
  const file = artifact(name);
  const scenario = scenarios.find(s => s.name === name)!;
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();
    if (mode === "streamed") applyChunk(container, rest, false);
    await sleep(40);
    flush();
    expect(container.textContent).toBe("failed: no user 7 HINTtail");
    expect(container.querySelectorAll("p").length).toBe(1);

    scenario.update!();
    flush();
    await sleep(30);
    flush();
    expect(container.textContent).toBe("user:u8tail");
    expect(warn).not.toHaveBeenCalled();
    // No fallback markup was sent, so no error record either.
    expect(rest).not.toContain('_$HY.r["3"]');
  } finally {
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

describe("#4287: Errored over a Loading whose read fails after the shell", () => {
  test("hydrated after the failure arrived: adopts the server's fallback", () => run("loaded"));
  test("hydrated before the failure arrived: shows it once, no ask", () => run("streamed"));
  test("fallback with a pending async hole, hydrated after the failure: renders it", () =>
    runAsyncFallback("loaded"));
  test("fallback with a pending async hole, hydrated before the failure: renders it", () =>
    runAsyncFallback("streamed"));
});
