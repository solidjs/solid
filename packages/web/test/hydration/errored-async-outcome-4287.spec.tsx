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
 *   the fragment rejects, with nothing of the server's swap left beside it,
 *   and asks nothing again: that render reads the memo a cycle after its
 *   error landed (a later tracked read retries an errored async node), but
 *   a boundary's resume is hydration, so the memo re-serves the server's
 *   error — no ask, no flash back to the loading fallback.
 * - The same inside an outer `<Loading>` still pending when it fails: the
 *   outer resume reads the memo, and re-serves its error too.
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
import { createRenderEffect, createRoot, createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  scenarios,
  postflushClientAskCount,
  postflushHoleAskCount,
  parkedAskCount
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

// An unrelated client write between stream pieces: the reactive clock moves
// on, as it does on any live page, so a read after the failure landed is on
// a later cycle than the failure.
const [tick, setTick] = createSignal(0);
createRoot(() => createRenderEffect(tick, () => {}));

// The stream after the shell, one script at a time (a template rides with
// the script after it), as a browser parses it — each piece followed by a
// clock tick. Returns the text after every step.
const pieces = (rest: string) => rest.match(/[\s\S]*?<\/script>/g) ?? [rest];
async function stream(container: HTMLDivElement, rest: string) {
  const seen: string[] = [container.textContent!];
  for (const piece of pieces(rest)) {
    applyChunk(container, piece, false);
    flush();
    await sleep(5);
    setTick(tick() + 1);
    flush();
    seen.push(container.textContent!);
  }
  for (let i = 0; i < 8; i++) {
    await sleep(5);
    flush();
    seen.push(container.textContent!);
  }
  return seen;
}

// Once the failure shows it stays: nothing flashes back to a loading state.
function expectSteady(seen: string[], final: string, before: string[]) {
  const at = seen.indexOf(final);
  expect(at).toBeGreaterThan(0);
  expect(new Set(seen.slice(0, at))).toEqual(new Set(before));
  expect(new Set(seen.slice(at))).toEqual(new Set([final]));
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
    if (mode === "streamed")
      expectSteady(await stream(container, rest), "failed: no user 7tail", ["loadingtail"]);
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
      // stays: nothing shows until the swap brings the finished fallback,
      // and it stays once it shows.
      const seen = await stream(container, rest);
      expect(seen.indexOf("failed: no user 7 HINTtail")).toBeGreaterThan(1);
      expectSteady(seen, "failed: no user 7 HINTtail", ["loadingtail"]);
    }
    await sleep(40);
    flush();
    expect(container.textContent).toBe("failed: no user 7 HINTtail");
    expect(container.querySelectorAll("p").length).toBe(1);
    if (mode === "loaded") expect(container.querySelector("p")).toBe(serverP);
    // The server's answers are used: neither read is asked again — hydrated
    // before the failure too, where the client renders it itself once `_fr`
    // rejects and that render reads `user` a cycle after its error landed.
    expect(postflushHoleAskCount()).toBe(asksBefore);

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

// Inside an outer Loading still pending when the read fails: the outer
// fragment carries the Errored fallback; hydrated mid-stream, the outer
// resume reads the memo (outside any claim — the Errored content claims
// nothing) a cycle after its error landed.
async function runParked(mode: "loaded" | "streamed") {
  const name = "errored-loading-parked-rejection-4287";
  const file = artifact(name);
  const scenario = scenarios.find(s => s.name === name)!;
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  expect(rest).toContain('_$HY.r["3002"]');
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const asksBefore = parkedAskCount();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    const serverP = container.querySelector("p");
    dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();
    if (mode === "streamed")
      expectSteady(await stream(container, rest), "outerfailed: no user 7tail", [
        "outer loadingtail"
      ]);
    await sleep(30);
    flush();
    expect(container.textContent).toBe("outerfailed: no user 7tail");
    expect(container.querySelectorAll("p").length).toBe(1);
    if (mode === "loaded") expect(container.querySelector("p")).toBe(serverP);
    expect(parkedAskCount()).toBe(asksBefore);

    // The Errored tracks the memo it adopted the failure of (#4273).
    scenario.update!();
    flush();
    await sleep(30);
    flush();
    expect(container.textContent).toBe("outeruser:u8tail");
    expect(parkedAskCount()).toBe(asksBefore + 1);
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
  test("inside a pending outer Loading, hydrated after the stream: adopts it", () =>
    runParked("loaded"));
  test("inside a pending outer Loading, hydrated mid-stream: no ask on the outer resume", () =>
    runParked("streamed"));
});
