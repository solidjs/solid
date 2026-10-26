/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4286: a bare `ssrSource: "client"` memo under `<Loading>` — the server
 * sends the boundary's fallback and the `"$$f"` client-continue marker. The
 * client hydrates that fallback, then resumes the content, which suspends on
 * the question it now asks. The hydrated fallback must stay on screen until
 * the content can show — not be dropped and rebuilt as fresh client DOM
 * (focus, selection or a running animation in it would be lost).
 *
 * Replays the `bare-client-memo` parity-harness artifact.
 */
import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios } from "../harness/scenarios.jsx";

const artifact = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../harness/__artifacts__/bare-client-memo.json"
);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

test("the hydrated $$f fallback stays until the client-only content resolves", async () => {
  const { App } = scenarios.find(s => s.name === "bare-client-memo")!;
  const { shell } = JSON.parse(readFileSync(artifact, "utf-8"));
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  container.innerHTML = shell.replace(scriptRe, "");
  for (const m of shell.matchAll(scriptRe)) (0, eval)(m[1]);
  const served = container.querySelector("p")!;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  dispose = hydrate(() => <App />, container);
  flush();
  // The resume runs on a microtask; the content's 5ms source is still pending.
  await sleep(0);
  flush();
  expect(container.textContent).toBe("wait");
  expect(container.querySelector("p")).toBe(served);
  expect(served.isConnected).toBe(true);

  await sleep(30);
  flush();
  expect(container.textContent).toBe("bare-0tail");
  expect(served.isConnected).toBe(false);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
  container.remove();
});
