/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3764: a live source created in the shell takes over when the root pass
 * ends, while a streamed boundary that reads it is still waiting on its
 * fragment. The boundary must still claim the server DOM with the server
 * value, then move to the live value. Replays the chunks
 * test/server/live-shell-source-3764.gen.spec.tsx renders.
 */
import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { A, B, C } from "../harness/live-shell-source-3764.jsx";

type Chunks = { shell: string; chunks: string[] };
const artifact = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../harness/__artifacts__/live-shell-source-3764.json"
    ),
    "utf-8"
  )
) as { a: Chunks; b: Chunks; c: Chunks };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

let dispose: (() => void) | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await sleep(0);
  container?.remove();
  delete (globalThis as any)._$HY;
});

async function run(art: Chunks, App: () => any, beforeChunks: number) {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const errors: unknown[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...a) => void errors.push(a[0]));
  const error = vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a[0]));
  container = document.createElement("div");
  document.body.appendChild(container);
  applyChunk(container, art.shell, true);
  dispose = hydrate(App, container);
  flush();
  await sleep(beforeChunks);
  flush();
  for (const c of art.chunks) applyChunk(container, c, false);
  await sleep(5);
  flush();
  const atResume = container.innerHTML;
  await sleep(80);
  flush();
  await sleep(20);
  warn.mockRestore();
  error.mockRestore();
  return { atResume, errors: errors.map(String) };
}

test("A: the boundary claims the server list while the shell takeover is in flight", async () => {
  const r = await run(artifact.a, () => <A liveMs={60} />, 10);
  expect(container!.querySelectorAll("ul").length).toBe(1);
  expect(container!.querySelector("ul")!.textContent).toBe("rows: 2");
  expect(r.errors).toEqual([]);
});

test("A: a live answer before the fragment still claims the server list, then shows the live value", async () => {
  const r = await run(
    artifact.a,
    () => <A liveMs={0} liveRows={[{ id: 1 }, { id: 2 }, { id: 3 }]} />,
    20
  );
  expect(r.atResume.match(/<ul/g)?.length).toBe(1);
  expect(container!.querySelectorAll("ul").length).toBe(1);
  expect(container!.querySelector("ul")!.textContent).toBe("rows: 3");
  expect(r.errors).toEqual([]);
});

test("B: a keyed <For> over a shell store claims the server rows", async () => {
  const r = await run(artifact.b, () => <B liveMs={0} />, 20);
  expect(container!.querySelector(".err")).toBeNull();
  expect(container!.querySelectorAll("ul").length).toBe(1);
  expect(container!.querySelector("ul")!.textContent).toBe("12");
  expect(r.errors).toEqual([]);
});

test("C: a shell value settled before the shell flushed reaches the boundary, then moves to the live value", async () => {
  const r = await run(
    artifact.c,
    () => <C liveMs={60} liveRows={[{ id: 1 }, { id: 2 }, { id: 3 }]} />,
    10
  );
  expect(r.atResume.match(/<ul/g)?.length).toBe(1);
  expect(container!.querySelectorAll("ul").length).toBe(1);
  expect(container!.textContent).toBe("shellslowrows: 3");
  expect(r.errors).toEqual([]);
});
