/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * A client write after the root pass to a source read both in the shell
 * and inside streamed boundaries still pending: the shell commits the write
 * at once; each boundary resumes against the server snapshot, then catches
 * up to the client's value — a boundary whose catch-up is async holds its
 * whole content on the snapshot until that lands, as a client-rendered page
 * holds a write. No hydration diagnostics. Replays the chunks
 * test/server/write-before-resume.gen.spec.tsx renders.
 */
import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { createSharedApp } from "../harness/write-before-resume.jsx";

const artifact = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../harness/__artifacts__/write-before-resume.json"
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

afterEach(async () => {
  await sleep(0);
  delete (globalThis as any)._$HY;
});

test("a write before a boundary resumes: the shell commits, the boundary resumes then catches up", async () => {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { App, navigate } = createSharedApp();
  const view = () => {
    const q = (s: string) => container.querySelector(s)?.textContent ?? null;
    return {
      shell: [q("h1"), q("h2")],
      side: [q(".inner"), q(".data"), q(".raw")],
      sync: q(".sync"),
      fallbacks: [...container.querySelectorAll("p")].map(p => p.textContent)
    };
  };

  applyChunk(container, artifact.shell, true);
  const dispose = hydrate(() => <App />, container);
  await sleep(5);
  flush();
  expect(view().fallbacks).toEqual(["side-loading", "sync-loading"]);

  navigate("/b");
  flush();
  await sleep(10);
  flush();
  expect(view()).toMatchObject({
    shell: ["title:/b", "label:/b"],
    fallbacks: ["side-loading", "sync-loading"]
  });

  for (const c of artifact.chunks) applyChunk(container, c, false);
  await sleep(5);
  flush();
  expect(view()).toMatchObject({
    shell: ["title:/b", "label:/b"],
    side: ["inner:/a", "data:/a", "/a"],
    sync: "sync:/b",
    fallbacks: []
  });

  await vi.waitFor(() => {
    flush();
    expect(view().side).toEqual(["inner:/b", "data:/b", "/b"]);
  });
  expect(view().shell).toEqual(["title:/b", "label:/b"]);

  const diagnostics = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
  dispose();
  container.remove();
  warn.mockRestore();
  error.mockRestore();
  expect(diagnostics).toEqual([]);
});
