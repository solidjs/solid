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
 * The landing never swallows a client write: one made before it in the same
 * flush, or one an effect makes in the landing's own flush, reaches `b`,
 * which computes the written value (one real ask).
 *
 * Replays the parity harness artifact (test/server/hydration-harness.spec.tsx).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRenderEffect, createRoot, createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios, servedSourceAskCount, servedSourceControl } from "../harness/scenarios.jsx";

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

// Hydrated mid-stream with a client write in the flush that lands `a`:
// `before` writes their input right after the script that settles `a`,
// before that landing runs; `effect` has an effect on `a` write `extra`,
// which `b` reads, inside the landing's flush.
async function runWrite(kind: "before" | "effect") {
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  servedSourceControl.write = kind === "effect";
  const asksBefore = servedSourceAskCount();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();
    const [first, ...others] = pieces(rest);
    expect(first).not.toContain("k12");
    applyChunk(container, first, false);
    // `a`'s landing is queued: this write precedes it, in the same flush.
    if (kind === "before") scenario.update!();
    await sleep(20);
    flush();
    for (const piece of others) {
      applyChunk(container, piece, false);
      flush();
      await sleep(5);
      flush();
    }
    await sleep(30);
    flush();
    // `b` computed the written value. (The boundary claims the server's
    // markup when it resumes after the write — its text stays the served
    // `k12`, as it does without this pass; the value is the pin here.)
    expect(servedSourceControl.b).toBe(kind === "before" ? "j12" : "k1x2");
    expect(servedSourceAskCount()).toBe(asksBefore + 1);
    expect(warn).not.toHaveBeenCalled();
  } finally {
    servedSourceControl.write = false;
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

describe("a served source's answer arriving does not re-ask its dependent", () => {
  test("hydrated after the stream", () => run("loaded"));
  test("hydrated mid-stream", () => run("streamed"));
  test("a client write before the landing, in its flush: computes the written value", () =>
    runWrite("before"));
  test("an effect's write in the landing's flush: computes the written value", () =>
    runWrite("effect"));
});
