/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/consistency/generic/** (the frames-free hydration
 * consistency pins and harness): renders test/harness/generic-hydration.tsx
 * in both fragment orders and writes the shell plus each later chunk.
 */
import { expect, test } from "vitest";
import { createGenericApp, type Order } from "../harness/generic-hydration.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

// The page's three flush points are timers 10–25 ms apart (the first
// boundary's `data` value at 5 ms, its fragment at 15 ms once `shared`
// settles, the other fragment at 40 ms). test/consistency/generic names
// them C0 C1 C2 and schedules writes between them, so the artifact must be
// exactly three chunks — which the recorder's stepped clock guarantees
// (see artifact-recorder.ts; this spec is where #3849 first needed it).
for (const order of ["ab", "ba"] as Order[]) {
  test(`render generic-hydration chunks (${order})`, async () => {
    const { App } = createGenericApp(order);
    const { shell, chunks } = await recordStream(() => <App />);
    expect(shell).toContain("a-loading");
    expect(shell).toContain("b-loading");
    expect(shell).toContain("label:/a");
    // The fragments land in the order the server settled them; the chunks
    // are the three flush points the schedules name as C0 C1 C2: the first
    // boundary's `data` value alone, that boundary's fragment (with
    // `shared`), the other fragment.
    const all = chunks.join("");
    const first = all.indexOf(order === "ab" ? "data:a" : "data:b");
    const second = all.indexOf(order === "ab" ? "data:b" : "data:a");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(all).toContain("shared:/a");
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toMatch(/^<script>/);
    expect(chunks[0]).not.toContain("<template");
    expect(chunks[1]).toMatch(/^<template id="/);
    expect(chunks[2]).toMatch(/^<template id="/);
    writeArtifact(`generic-hydration-${order}`, { shell, chunks });
  });
}
