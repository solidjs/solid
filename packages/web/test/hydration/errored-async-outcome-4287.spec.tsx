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
 *   the failure waits for the fallback (RULES-DERIVED D-18, #4306): the
 *   loading placeholder stays until the fragment swaps in the finished
 *   fallback with the error record, and the client claims it.
 *
 * Replays the parity harness artifact (test/server/hydration-harness.spec.tsx).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  scenarios,
  postflushClientAskCount,
  postflushHoleAskCount
} from "../harness/scenarios.jsx";

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

// The stream after the shell, one script at a time (a template rides with
// the script after it), as a browser parses it.
const pieces = (rest: string) => rest.match(/[\s\S]*?<\/script>/g) ?? [rest];

async function runAsyncFallback(mode: "loaded" | "streamed") {
  const name = "errored-loading-postflush-rejection-async-fallback-4287";
  const file = artifact(name);
  const scenario = scenarios.find(s => s.name === name)!;
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  // The failure waited for its fallback: the fragment carries it finished,
  // and the error record at the Errored id with it (#4306).
  expect(rest).toContain('_$HY.r["3"]');
  expect(rest).toContain("HINT<!--/--></p></template>");
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const asksBefore = postflushHoleAskCount();
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
      // Between the failure and the hint landing the loading placeholder
      // stays: nothing shows until the swap brings the finished fallback.
      const seen: string[] = [container.textContent!];
      for (const piece of pieces(rest)) {
        applyChunk(container, piece, false);
        flush();
        await sleep(5);
        flush();
        seen.push(container.textContent!);
      }
      const swapped = seen.indexOf("failed: no user 7 HINTtail");
      expect(swapped).toBeGreaterThan(1);
      expect(new Set(seen.slice(0, swapped))).toEqual(new Set(["loadingtail"]));
    }
    await sleep(40);
    flush();
    expect(container.textContent).toBe("failed: no user 7 HINTtail");
    expect(container.querySelectorAll("p").length).toBe(1);
    if (mode === "loaded") expect(container.querySelector("p")).toBe(serverP);
    // Hydrated after the failure, the server's answers are used: neither
    // read is asked again. Hydrated before it, the client renders the
    // failure itself once `_fr` rejects (as for the plain fallback), and
    // that fresh read of `user` — a cycle after its error landed — retries
    // it: one ask, during which the inner Loading shows its fallback again.
    expect(postflushHoleAskCount()).toBe(asksBefore + (mode === "streamed" ? 1 : 0));

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

describe("#4287: Errored over a Loading whose read fails after the shell", () => {
  test("hydrated after the failure arrived: adopts the server's fallback", () => run("loaded"));
  test("hydrated before the failure arrived: shows it once, no ask", () => run("streamed"));
  test("fallback with a pending async hole, hydrated after the failure: adopts it", () =>
    runAsyncFallback("loaded"));
  test("fallback with a pending async hole, hydrated before the failure: placeholder until the swap", () =>
    runAsyncFallback("streamed"));
});
