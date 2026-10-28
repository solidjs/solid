/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4348: an `<Errored>` the server rendered as its fallback (inside a
 * `<Loading>` whose read fails after the shell), its content creating what it
 * renders lazily — not in the content's own run but when the boundary
 * flattens it: behind a context provider (the issue's dropdown trigger), a
 * component returning a function, a `children()` accessor, a provider around
 * a nested Loading, Errored, Show or For, or around a component whose own
 * async memo is created there (its server answer adopted by id). `direct`
 * (created in the content's own run) is the control. The markup is the
 * server's fallback, so nothing under the content claims server DOM — no
 * `Hydration key miss`, no detached element — whenever it is created. The
 * fallback stays up with its server node, nothing is asked again, and the
 * boundary recovers when the memo's input changes.
 *
 * Replays the parity harness artifacts (test/server/hydration-harness.spec.tsx).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { hydrate } from "@solidjs/web";
import {
  lazyErroredShapes,
  lazyErroredContent,
  lazyErroredName,
  lazyErroredAskCount,
  setLazyErroredKey,
  type LazyErroredShape
} from "../harness/scenarios.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

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

async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(10);
    flush();
  }
}

async function run(shape: LazyErroredShape, mode: "loaded" | "streamed") {
  const file = artifact(lazyErroredName(shape));
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  const App = lazyErroredContent(shape);
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrapHydrationGlobal();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const asksBefore = lazyErroredAskCount();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    const main = container.querySelector("main");
    let serverP = container.querySelector("p");
    dispose = hydrate(() => <App />, container);
    await settle();
    if (mode === "streamed") {
      expect(container.textContent).toBe("loadingtail");
      // The pieces: the fallback's swap with the error (after, for `inner`,
      // the rejection of the memo created under the content), the
      // fragment's settle, then (`loading`) the nested Loading's own
      // fragment, which the server still streams for the content it dropped.
      const pieces: string[] = rest.match(/[\s\S]*?<\/script>/g)!;
      const swap = pieces.findIndex(p => p.includes("<template id="));
      for (let i = 0; i < pieces.length; i++) {
        applyChunk(container, pieces[i], false);
        await settle();
        // Once the boundary's fragment settled, hydration is over: nothing
        // under the content waits to claim — that nested fragment included.
        if (i > swap) expect(sharedConfig.isHydrationInProgress!()).toBe(false);
      }
      serverP = container.querySelector("p");
    }
    // The server's fallback stays up: its node, nothing of the content
    // beside it, and nothing under the content tried to claim.
    expect(container.textContent).toBe("failed: no user 7tail");
    expect(container.querySelector("main")).toBe(main);
    expect(container.querySelector("p")).toBe(serverP);
    expect(container.querySelectorAll("p").length).toBe(1);
    expect(container.querySelector("button")).toBeNull();
    expect(lazyErroredAskCount()).toBe(asksBefore);
    expect(warn).not.toHaveBeenCalled();
    // Hydration is over: nothing under the content waits to claim.
    expect(sharedConfig.isHydrationInProgress!()).toBe(false);

    // Still held a while later.
    await settle();
    expect(container.querySelector("p")).toBe(serverP);
    expect(lazyErroredAskCount()).toBe(asksBefore);

    // The input changes: the boundary recovers with the client's content.
    setLazyErroredKey(shape, "u8");
    await settle();
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("button")!.textContent).toBe("user:u8");
    expect(container.textContent).toBe(
      `${shape === "errored" || shape === "loading" ? "ok" : ""}user:u8tail`
    );
    expect(container.querySelector("main")).toBe(main);
    // One ask per memo reading the input: the client's own, after the change.
    expect(lazyErroredAskCount()).toBe(asksBefore + (shape === "inner" ? 2 : 1));
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

describe("#4348: a hydrated Errored fallback over lazily created content", () => {
  for (const shape of lazyErroredShapes) {
    test(`${shape}: hydrated after the failure arrived`, () => run(shape, "loaded"));
    test(`${shape}: hydrated before the failure arrived`, () => run(shape, "streamed"));
  }
});
