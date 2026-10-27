/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * A client write, after the root pass, to a shell source read inside a
 * streamed boundary still pending. When the boundary's fragment arrives and
 * is claimed, every binding reading the written source shows the client's
 * value — whether it reads the signal directly, a sync shell memo, or an
 * async shell memo — not the server's text it adopted. Replays the chunks
 * test/server/claim-stale-text.gen.spec.tsx renders.
 */
import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { createPendingApp, createSharedApp } from "../harness/claim-stale-text.jsx";

const load = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../harness/__artifacts__/${name}.json`),
      "utf-8"
    )
  ) as { shell: string; chunks: string[] };
const artifact = load("claim-stale-text");
const pending = load("claim-stale-text-pending");

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

test("a boundary claimed after a shell write shows the client's value", async () => {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { App, write } = createSharedApp();
  const q = (s: string) => container.querySelector(s)?.textContent ?? null;
  const side = () => [q(".raw"), q(".sync"), q(".async"), q(".only")];

  applyChunk(container, artifact.shell, true);
  const dispose = hydrate(() => <App />, container);
  await sleep(5);
  flush();
  expect(q("h1")).toBe("async:k");
  expect(q("p")).toBe("loading");

  write("j");
  flush();
  await sleep(10);
  flush();
  expect(q("h1")).toBe("async:j");
  expect(q("p")).toBe("loading");

  for (const c of artifact.chunks) applyChunk(container, c, false);
  await sleep(5);
  flush();
  expect(q("p")).toBe(null);
  expect(q(".gate")).toBe("gate");

  await vi.waitFor(() => {
    flush();
    expect(side()).toEqual(["raw:j", "sync:j", "async:j", "only:j"]);
  });
  expect(q("h1")).toBe("async:j");

  const diagnostics = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
  dispose();
  container.remove();
  warn.mockRestore();
  error.mockRestore();
  expect(diagnostics).toEqual([]);
});

// The boundary's own sources were still pending on the server when the
// shell flushed: `slow`'s answer streams in a chunk of its own, `chained`'s
// with the fragment. The write lands after `at` chunks — 0, before any
// answer; 1, after `slow`'s — and either in a flush of its own or in the
// flush that lands those chunks (`flushed: false`). `settle` lets the
// client's answers land before the fragment arrives; without it they are
// still in flight when the boundary claims.
const pendingCases = [
  { at: 0, flushed: true, settle: true },
  { at: 1, flushed: true, settle: true },
  { at: 0, flushed: true, settle: false },
  { at: 1, flushed: true, settle: false },
  { at: 1, flushed: false, settle: false }
];
test.each(pendingCases)(
  "a boundary held by pending shell memos, written after $at chunk(s) (flushed: $flushed, settled: $settle): shows the client's value",
  async ({ at, flushed, settle }) => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { App, write } = createPendingApp();
    const q = (s: string) => container.querySelector(s)?.textContent ?? null;
    const side = () => [q(".slow"), q(".chained")];

    applyChunk(container, pending.shell, true);
    const dispose = hydrate(() => <App />, container);
    await sleep(5);
    flush();
    expect(q("p")).toBe("loading");
    const chunks = [...pending.chunks];
    for (let i = 0; i < at; i++) {
      applyChunk(container, chunks.shift()!, false);
      if (!flushed) break;
      await sleep(5);
      flush();
    }

    write("j");
    flush();
    expect(q("h1")).toBe("head:j");
    if (settle) {
      await sleep(40);
      flush();
      expect(q("p")).toBe("loading");
    }

    // Once the fragment is in, the fallback never comes back: the claim
    // shows the server's content, which then catches up.
    let refallback = 0;
    const observer = new MutationObserver(records => {
      for (const r of records)
        for (const n of r.addedNodes) if ((n as Element).localName === "p") refallback++;
    });
    for (const c of chunks) {
      applyChunk(container, c, false);
      if (c === chunks[chunks.length - 1]) {
        expect(side()).toEqual(["slow:k", "chained:slow:k"]);
        observer.observe(container, { childList: true, subtree: true });
      }
      await sleep(5);
      flush();
    }
    await vi.waitFor(() => {
      flush();
      expect(side()).toEqual(["slow:j", "chained:slow:j"]);
    });
    observer.disconnect();
    expect(refallback).toBe(0);
    expect(q("p")).toBe(null);
    expect(q("h1")).toBe("head:j");

    const diagnostics = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
    dispose();
    container.remove();
    warn.mockRestore();
    error.mockRestore();
    expect(diagnostics).toEqual([]);
  }
);
