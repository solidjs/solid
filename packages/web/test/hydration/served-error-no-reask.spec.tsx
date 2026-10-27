/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Never refetch on hydration: an error the server sent is the server's
 * answer, and the hydrating client never asks again for it.
 *
 * - `nested-rejection-no-outcome`: a failure the server could not draw (the
 *   inner fragment rejects with no outcome: the shell's `<Errored>` and the
 *   outer fragment were already on the wire). The client renders the
 *   fragment fresh, so its graph is created, but every read in it claims
 *   what the server sent: the sibling read its value, the failed read its
 *   error, thrown to the nearest client boundary, the shell's Errored. No
 *   ask. reset() asks, and the recreated graph is live.
 * - `served-error-reread`: mid-hydration (a slow boundary still pending)
 *   the served error stands with no ask, also when an unrelated client
 *   write re-runs its reader (a later tracked read that retries the errored
 *   memo, PJ-R35, with none of its sources changed). A write to its own
 *   source is a real change, and the Errored's reset() a real retry: each
 *   asks and recovers right away, hydration still running.
 * - `abandoned-sibling-computes`: a fragment fails on the server (a render
 *   error, no record) while a nested read is still pending; the server
 *   abandons that read. The fresh render takes the served values for the
 *   reads the server finished (one after an element: the render's ids line
 *   up with the server's) and computes only the abandoned one, which the
 *   server never answered: one ask, its own value, a live graph.
 *
 * Replays the parity harness artifacts (test/server/hydration-harness.spec.tsx).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  scenarios,
  abandonedSiblingAsks,
  nestedRejectionAskCount,
  nestedRejectionControl,
  nestedRejectionSiblingAskCount,
  servedErrorAskCount,
  servedErrorControl
} from "../harness/scenarios.jsx";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const load = (name: string) => {
  const file = resolve(
    dirname(fileURLToPath(import.meta.url)),
    `../harness/__artifacts__/${name}.json`
  );
  expect(existsSync(file)).toBe(true);
  return {
    ...(JSON.parse(readFileSync(file, "utf-8")) as { shell: string; rest: string }),
    scenario: scenarios.find(s => s.name === name)!
  };
};

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}
// The stream after the shell, one script at a time (a template rides with
// the script after it), as a browser parses it.
const pieces = (rest: string) => rest.match(/[\s\S]*?<\/script>/g) ?? [rest];
async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(5);
    flush();
  }
}

async function withPage(
  name: string,
  body: (container: HTMLDivElement, rest: string) => Promise<void>
) {
  const { shell, rest, scenario } = load(name);
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // A rejected record the stream settles before anything on the client
  // reads it is reported unhandled; it is the server's error, nothing else.
  const rejections: string[] = [];
  const onRejection = (r: unknown) => void rejections.push(String(r));
  process.on("unhandledRejection", onRejection);
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    await body(container, rest);
    // `body` hydrates; the harness disposes it.
    dispose = (container as any).__dispose;
    expect(warn).not.toHaveBeenCalled();
    await sleep(5);
    for (const r of rejections) expect(r).toBe("Error: no user 7");
  } finally {
    process.off("unhandledRejection", onRejection);
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
  void scenario;
}
function start(container: HTMLDivElement, App: () => any) {
  (container as any).__dispose = hydrate(() => <App />, container);
  flush();
}

describe("a failure the server could not draw: adopted, thrown to the nearest client boundary", () => {
  const name = "nested-rejection-no-outcome";
  for (const mode of ["loaded", "streamed"] as const)
    test(`[${mode}] the shell's Errored shows the server's error, no ask; reset() asks`, () =>
      withPage(name, async (container, rest) => {
        const { scenario } = load(name);
        const asks = nestedRejectionAskCount();
        const siblingAsks = nestedRejectionSiblingAskCount();
        if (mode === "loaded") applyChunk(container, rest, false);
        start(container, scenario.App);
        await settle();
        if (mode === "streamed")
          for (const piece of pieces(rest)) {
            applyChunk(container, piece, false);
            await settle();
          }
        await settle();
        expect(container.textContent).toBe("failed: no user 7tail");
        // The fresh render claimed what the server sent: its error for
        // `user`, its value for `b`. Nothing is asked again.
        expect(nestedRejectionAskCount()).toBe(asks);
        expect(nestedRejectionSiblingAskCount()).toBe(siblingAsks);

        nestedRejectionControl.reset!();
        await settle();
        await sleep(30);
        await settle();
        expect(nestedRejectionAskCount()).toBe(asks + 1);
        expect(container.textContent).toBe("ac0bu7tail");
        // The recreated graph is live.
        container.querySelector<HTMLButtonElement>("#nested-rejection-count")!.click();
        flush();
        expect(container.textContent).toBe("ac1bu7tail");
      }));
});

describe("a served error mid-hydration", () => {
  const name = "served-error-reread";
  test("mid-hydration: the server's error, no ask; reset() asks and recovers", () =>
    withPage(name, async (container, rest) => {
      const { scenario } = load(name);
      const asks = servedErrorAskCount();
      start(container, scenario.App);
      await settle();
      const all = pieces(rest);
      // Up to the failure; the slow boundary is still pending.
      let i = 0;
      while (!container.textContent!.includes("failed")) {
        applyChunk(container, all[i++], false);
        await settle();
      }
      applyChunk(container, all[i++], false);
      await settle();
      expect(container.textContent).toBe("failed: no user 7slow loading");
      expect((globalThis as any)._$HY.done).toBeFalsy();
      expect(servedErrorAskCount()).toBe(asks);

      // reset() is a real retry, mid-hydration too.
      servedErrorControl.reset!();
      await settle();
      expect(servedErrorAskCount()).toBe(asks + 1);
      expect(container.textContent).toBe("0:u7slow loading");

      for (; i < all.length; i++) {
        applyChunk(container, all[i], false);
        await settle();
      }
      await settle();
      expect(container.textContent).toBe("0:u7slow");
      expect(servedErrorAskCount()).toBe(asks + 1);
    }));

  test("mid-hydration: a write re-running its reader keeps the server's error; a source write asks", () =>
    withPage(name, async (container, rest) => {
      const { scenario } = load(name);
      const asks = servedErrorAskCount();
      start(container, scenario.App);
      await settle();
      const all = pieces(rest);
      let i = 0;
      while (!container.textContent!.includes("failed")) {
        applyChunk(container, all[i++], false);
        await settle();
      }
      applyChunk(container, all[i++], false);
      await settle();
      expect(container.textContent).toBe("failed: no user 7slow loading");
      expect((globalThis as any)._$HY.done).toBeFalsy();
      expect(servedErrorAskCount()).toBe(asks);

      // An unrelated write re-runs the reader, which retries the errored
      // memo: none of its sources changed, so the server's error stands.
      servedErrorControl.setN!(1);
      await settle();
      expect(container.textContent).toBe("failed: no user 7slow loading");
      expect(servedErrorAskCount()).toBe(asks);
      servedErrorControl.setN!(2);
      await settle();
      expect(servedErrorAskCount()).toBe(asks);

      // A write to its own source is a real change: it asks, and recovers.
      servedErrorControl.setUid!(8);
      await settle();
      expect(servedErrorAskCount()).toBe(asks + 1);
      expect(container.textContent).toBe("2:u8slow loading");
      expect((globalThis as any)._$HY.done).toBeFalsy();

      for (; i < all.length; i++) {
        applyChunk(container, all[i], false);
        await settle();
      }
      await settle();
      expect(container.textContent).toBe("2:u8slow");
      expect(servedErrorAskCount()).toBe(asks + 1);
    }));

  test("loaded: the server's error, no ask; a write re-running its reader keeps it", () =>
    withPage(name, async (container, rest) => {
      const { scenario } = load(name);
      const asks = servedErrorAskCount();
      applyChunk(container, rest, false);
      start(container, scenario.App);
      await settle();
      await settle();
      expect(container.textContent).toBe("failed: no user 7slow");
      expect(servedErrorAskCount()).toBe(asks);
      // Hydration is over: a later tracked read retries, as on any client.
      expect((globalThis as any)._$HY.done).toBe(true);
      servedErrorControl.setN!(1);
      await settle();
      expect(servedErrorAskCount()).toBe(asks + 1);
      expect(container.textContent).toBe("1:u7slow");
    }));
});

describe("a read the server abandoned computes; served reads are adopted", () => {
  const name = "abandoned-sibling-computes";
  for (const mode of ["loaded", "streamed"] as const)
    test(`[${mode}] one ask, for the abandoned read only`, () =>
      withPage(name, async (container, rest) => {
        const { scenario } = load(name);
        const asks = abandonedSiblingAsks();
        if (mode === "loaded") applyChunk(container, rest, false);
        start(container, scenario.App);
        await settle();
        if (mode === "streamed")
          for (const piece of pieces(rest)) {
            applyChunk(container, piece, false);
            await settle();
          }
        await settle();
        expect(container.textContent).toBe("adc!an0tail");
        const now = abandonedSiblingAsks();
        // `a` and `d` are the server's answers (`d`'s id, after an element,
        // lines up with the server's); `c` never got one, so it computes.
        expect(now.a - asks.a).toBe(0);
        expect(now.d - asks.d).toBe(0);
        expect(now.c - asks.c).toBe(1);
        expect((globalThis as any)._$HY.done).toBe(true);
        container.querySelector<HTMLButtonElement>("#abandoned-sibling-count")!.click();
        flush();
        expect(container.textContent).toBe("adc!an1tail");
      }));
});
