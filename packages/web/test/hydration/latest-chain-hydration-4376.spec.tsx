/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4376: a chain of async memos, each over `latest()` of the one before
 * (`m1 = fetchB(1 + latest(m0))`, `m2 = fetchC(1 + latest(m1))`), under
 * `<Errored>` > `<Loading>`. The server streams the three answers (4, 5, 6)
 * and the fragment `<span data-a="6">`. Only `m0`'s record is in the shell:
 * `m1`'s and `m2`'s arrive with the later chunks. A client that hydrates
 * before them adopts each answer by id and asks nothing again before the
 * first client write — `latest(m1)` inside `m2`'s compute is NotReady until
 * `m1`'s answer is adopted, never `undefined` (A7; `fetchC(NaN)` was asked
 * for real).
 *
 * Replays the parity harness artifact (test/server/hydration-harness.spec.tsx).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { latestChainAsks, scenarios, setLatestChain } from "../harness/scenarios.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

const name = "latest-chain-hydration-4376";
const artifact = resolve(
  dirname(fileURLToPath(import.meta.url)),
  `../harness/__artifacts__/${name}.json`
);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(10);
    flush();
  }
}

async function run(mode: "loaded" | "streamed") {
  expect(existsSync(artifact)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(artifact, "utf-8"));
  // m1's and m2's records stream after the shell.
  expect(shell).not.toContain('_$HY.r["1"]');
  expect(rest).toContain('_$HY.r["2"]');
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrapHydrationGlobal();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  latestChainAsks.length = 0;
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    dispose = hydrate(() => <App />, container);
    flush();
    await settle();
    if (mode === "streamed") {
      expect(container.textContent).toBe("[ROOT-L]");
      for (const piece of rest.match(/[\s\S]*?<\/script>/g)!) {
        applyChunk(container, piece, false);
        await settle();
      }
    }
    await settle();
    const span = container.querySelector("span")!;
    expect(span.getAttribute("data-a")).toBe("6");
    expect(container.textContent).toBe("6");
    // No refetch: every answer is the server's.
    expect(latestChainAsks).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    // The first client write asks the chain; each hop re-asks as the latest
    // answer beneath it lands, and ends over the new answers.
    setLatestChain(4);
    for (let i = 0; i < 3; i++) await settle();
    expect(latestChainAsks[0]).toBe("a:5");
    expect(latestChainAsks).toContain("c:7");
    expect(latestChainAsks.some(a => a.includes("NaN"))).toBe(false);
    expect(container.querySelector("span")!.getAttribute("data-a")).toBe("7");
    expect(container.textContent).toBe("7");
  } finally {
    warn.mockRestore();
    error.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

const App = scenarios.find(s => s.name === name)!.App;

describe("#4376: an async chain over latest() hydrates without asking", () => {
  test("hydrated after the stream", () => run("loaded"));
  test("hydrated before m1's and m2's records arrive", () => run("streamed"));
});
