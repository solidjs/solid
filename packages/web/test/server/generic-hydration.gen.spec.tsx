/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/consistency/generic/** (the frames-free hydration
 * consistency pins and harness): renders test/harness/generic-hydration.tsx
 * in both fragment orders and writes the shell plus each later chunk.
 */
import { afterEach, expect, test, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { createGenericApp, type Order } from "../harness/generic-hydration.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

afterEach(() => {
  vi.useRealTimers();
});

// The page's three flush points are timers 10–25 ms apart (the first
// boundary's `data` value at 5 ms, its fragment at 15 ms once `shared`
// settles, the other fragment at 40 ms) and the stream coalesces whatever
// settles in one event-loop turn into one chunk (`deferFlush`). Under load
// — the parallel server suite, a CI runner — two of them fall due in the
// same turn and the artifact records two chunks (or the two settled values
// in the other order), which shifts every schedule's chunk indices in
// test/consistency/generic (a `C2` with no chunk; a "write between the
// reveals" that is a write after both). So the render runs on a fake clock
// stepped one millisecond at a time: each timer fires in its own turn, with
// its microtasks and its flush, and the chunks are the page's three flush
// points on every host.
async function renderOrder(order: Order) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "clearImmediate"] });
  const { App } = createGenericApp(order);
  const chunks: string[] = [];
  let shell: string | undefined;
  let shellDone = false;
  let ended = false;
  renderToStream(() => <App />, {
    onCompleteShell() {
      shellDone = true;
    }
  }).pipe({
    write(c: string) {
      chunks.push(c);
      if (shellDone && shell === undefined) shell = chunks.splice(0).join("");
    },
    end() {
      if (shell === undefined) shell = chunks.splice(0).join("");
      ended = true;
    }
  });
  for (let ms = 0; ms < 1000 && !ended; ms++) await vi.advanceTimersByTimeAsync(1);
  expect(ended).toBe(true);
  return { shell: shell!, chunks };
}

for (const order of ["ab", "ba"] as Order[]) {
  test(`render generic-hydration chunks (${order})`, async () => {
    const out = await renderOrder(order);
    expect(out.shell).toContain("a-loading");
    expect(out.shell).toContain("b-loading");
    expect(out.shell).toContain("label:/a");
    // The fragments land in the order the server settled them; the chunks
    // are the three flush points the schedules name as C0 C1 C2: the first
    // boundary's `data` value alone, that boundary's fragment (with
    // `shared`), the other fragment.
    const all = out.chunks.join("");
    const first = all.indexOf(order === "ab" ? "data:a" : "data:b");
    const second = all.indexOf(order === "ab" ? "data:b" : "data:a");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(all).toContain("shared:/a");
    expect(out.chunks.length).toBe(3);
    expect(out.chunks[0]).toMatch(/^<script>/);
    expect(out.chunks[0]).not.toContain("<template");
    expect(out.chunks[1]).toMatch(/^<template id="/);
    expect(out.chunks[2]).toMatch(/^<template id="/);
    writeFileSync(
      resolve(artifactsDir, `generic-hydration-${order}.json`),
      JSON.stringify(out, null, 2)
    );
  });
}
