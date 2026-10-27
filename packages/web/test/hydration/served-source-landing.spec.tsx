/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * An async shell memo `b` reading another, `a`, both read only inside a
 * streamed `<Loading>`. Hydrated mid-stream, `a`'s server answer arrives
 * before `b`'s and re-runs `b`: that rerun is the server's answer for a
 * source arriving, not a client write, so `b` re-serves its own server
 * answer — nothing is asked again, in either replay order. A client write
 * to their input afterwards recomputes them (one real ask for `b`).
 *
 * Replays the parity harness artifact (test/server/hydration-harness.spec.tsx).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRenderEffect, createRoot, createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios, servedSourceAskCount } from "../harness/scenarios.jsx";

const name = "served-source-landing";
const file = resolve(
  dirname(fileURLToPath(import.meta.url)),
  `../harness/__artifacts__/${name}.json`
);
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

// An unrelated client write after each stream piece moves the reactive
// clock on, as on any live page.
const [tick, setTick] = createSignal(0);
createRoot(() => createRenderEffect(tick, () => {}));
const pieces = (rest: string) => rest.match(/[\s\S]*?<\/script>/g) ?? [rest];

async function run(mode: "loaded" | "streamed") {
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  // The two answers arrive in separate scripts, `a`'s first.
  expect(pieces(rest).length).toBeGreaterThan(1);
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const asksBefore = servedSourceAskCount();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();
    if (mode === "streamed") {
      expect(container.textContent).toBe("loadingtail");
      for (const piece of pieces(rest)) {
        applyChunk(container, piece, false);
        flush();
        await sleep(5);
        setTick(tick() + 1);
        flush();
        expect(["loadingtail", "b:k12tail"]).toContain(container.textContent);
      }
    }
    await sleep(30);
    flush();
    expect(container.textContent).toBe("b:k12tail");
    expect(servedSourceAskCount()).toBe(asksBefore);

    scenario.update!();
    flush();
    await sleep(30);
    flush();
    expect(container.textContent).toBe("b:j12tail");
    expect(servedSourceAskCount()).toBe(asksBefore + 1);
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

describe("a served source's answer arriving does not re-ask its dependent", () => {
  test("hydrated after the stream", () => run("loaded"));
  test("hydrated mid-stream", () => run("streamed"));
});
