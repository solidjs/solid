/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Navigate (a location write) while boundaries streamed by the initial SSR
 * are still pending: shell nodes outside every pending boundary recompute on
 * the write instead of re-adopting their server values until the page's last
 * boundary resumes. Also pins why Solid Router's former
 * `if (registry && !done) done = true` at the write is gone: ending
 * hydration there misclaims a boundary that is still pending. Replays the
 * chunks test/server/nav-before-resume.gen.spec.tsx renders.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { hydrate } from "@solidjs/web";
import { createNavApp } from "../harness/nav-before-resume.jsx";

const artifact = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../harness/__artifacts__/nav-before-resume.json"
    ),
    "utf-8"
  )
) as { shell: string; chunks: string[] };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

async function run(endAtNavigation: boolean) {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  const seen = { settled: 0, hydrationEnd: 0, sideTaken: [] as unknown[], bRendered: 0 };
  const { App, navigate } = createNavApp({
    settled: () => seen.settled++,
    sideTaken: v => seen.sideTaken.push(v),
    bRendered: () => seen.bRendered++
  });

  applyChunk(container, artifact.shell, true);
  const shellH1 = container.querySelector("h1");
  const dispose = hydrate(() => <App />, container);
  sharedConfig.onHydrationEnd!(() => seen.hydrationEnd++);
  await sleep(5);
  flush();
  const beforeNav = {
    text: container.textContent,
    inProgress: sharedConfig.isHydrationInProgress!()
  };

  // Solid Router's former `if (registry && !done) done = true` at the write
  if (endAtNavigation && sharedConfig.registry && !sharedConfig.done) sharedConfig.done = true;
  navigate("/b");
  flush();
  await sleep(10);
  flush();
  const afterNav = {
    h1: container.querySelector("h1")!.textContent,
    h2: container.querySelector("h2")!.textContent,
    h1Claimed: container.querySelector("h1") === shellH1,
    route: container.querySelector("section")!.textContent,
    side: container.querySelector("aside, p")!.textContent,
    hydrationEnd: seen.hydrationEnd,
    inProgress: sharedConfig.isHydrationInProgress!()
  };

  for (const c of artifact.chunks) {
    applyChunk(container, c, false);
    await sleep(5);
    flush();
  }
  await sleep(120);
  flush();
  const end = {
    h1: container.querySelector("h1")!.textContent,
    route: container.querySelector("section")!.textContent,
    side: container.querySelector("aside")?.textContent,
    // inert: a disposed boundary's late <template> stays unswapped
    leftoverTemplates: container.querySelectorAll("template").length,
    strayA: /a-data|a-loading/.test(container.textContent!),
    hydrationEnd: seen.hydrationEnd,
    settled: seen.settled,
    sideTaken: seen.sideTaken,
    bRendered: seen.bRendered,
    inProgress: sharedConfig.isHydrationInProgress!(),
    done: sharedConfig.done
  };
  const diagnostics = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
  dispose();
  container.remove();
  warn.mockRestore();
  error.mockRestore();
  await sleep(0);
  return { beforeNav, afterNav, end, diagnostics };
}

describe("navigation before the initial SSR's streamed boundaries resume", () => {
  afterEach(async () => {
    await sleep(0);
    delete (globalThis as any)._$HY;
  });

  test("shell nodes recompute on the write, pending boundaries resume, hydration ends once", async () => {
    const r = await run(false);
    expect(r.beforeNav.inProgress).toBe(true);
    expect(r.afterNav).toMatchObject({
      h1: "title:/b",
      h2: "label:/b",
      h1Claimed: true,
      route: "page b",
      side: "side-loading",
      hydrationEnd: 0,
      inProgress: true
    });
    expect(r.end).toMatchObject({
      h1: "title:/b",
      route: "page b",
      side: "side-data",
      strayA: false,
      hydrationEnd: 1,
      settled: 1,
      bRendered: 1,
      inProgress: false,
      done: true
    });
    expect(r.end.sideTaken).toEqual([{ status: "resolved", value: { n: 42 } }]);
    expect(r.diagnostics).toEqual([]);
  });

  test("ending hydration at the write misclaims a still-pending boundary", async () => {
    const r = await run(true);
    expect(r.afterNav.hydrationEnd).toBe(1);
    expect(r.end.side).toBe("side-data");
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toContain("Hydration key miss");
  });
});
