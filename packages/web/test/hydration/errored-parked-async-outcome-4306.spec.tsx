/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4306: `<Errored>` with an async hole in its fallback, around a
 * `<Loading>` whose read fails after the shell, inside an outer `<Loading>`
 * still pending when it fails. The failure waits out the fallback's hole
 * while parked in the outer fragment, so the server sends the finished
 * fallback (and the error record at the Errored id):
 *
 * - hole settled before the outer Loading: inside the outer fragment;
 * - hole settled after it: the outer fragment carries the inner
 *   placeholder, and the inner fragment streams the fallback.
 *
 * The client claims that markup in both replay orders, without warnings;
 * hydrated after the stream it asks nothing again.
 *
 * Replays the parity harness artifacts (test/server/hydration-harness.spec.tsx).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios, parkedHoleAskCount } from "../harness/scenarios.jsx";

const artifact = (name: string) =>
  resolve(dirname(fileURLToPath(import.meta.url)), `../harness/__artifacts__/${name}.json`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

async function run(name: string, mode: "loaded" | "streamed") {
  const file = artifact(name);
  const scenario = scenarios.find(s => s.name === name)!;
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  // The server sends the finished fallback and the error record with it.
  expect(rest).toContain("HINT<!--/--></p>");
  expect(rest).toContain('_$HY.r["4002"]');
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const asksBefore = parkedHoleAskCount();
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
      expect(container.textContent).toBe("outer loadingtail");
      applyChunk(container, rest, false);
    }
    await sleep(50);
    flush();
    expect(container.textContent).toBe("outerfailed: no user 7 HINTtail");
    expect(container.querySelectorAll("p").length).toBe(1);
    if (mode === "loaded") expect(container.querySelector("p")).toBe(serverP);
    // The server's answer is used: nothing is asked again. (Hydrated
    // mid-stream, the memo re-asks on the outer boundary's resume, as for
    // the parked failure with a plain fallback — see the scenario notes.)
    expect(parkedHoleAskCount()).toBe(asksBefore + (mode === "streamed" ? 1 : 0));
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

const early = "errored-loading-parked-rejection-async-fallback-4306";
const late = "errored-loading-parked-rejection-late-async-fallback-4306";

describe("#4306: parked failure, Errored fallback with an async hole", () => {
  test("hole settles before the outer Loading, hydrated after the stream", () =>
    run(early, "loaded"));
  test("hole settles before the outer Loading, hydrated mid-stream", () => run(early, "streamed"));
  test("hole settles after the outer Loading, hydrated after the stream", () =>
    run(late, "loaded"));
  test("hole settles after the outer Loading, hydrated mid-stream", () => run(late, "streamed"));
});
