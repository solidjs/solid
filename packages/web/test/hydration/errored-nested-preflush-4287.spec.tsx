/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4287 follow-up: an `<Errored>` whose content is more than the failing
 * `<Loading>` — markup between them, a sibling beside it, a sibling
 * `<Loading>` settled or still pending — with the read failing before the
 * shell is handed to the sink. The shell carries the Errored fallback in
 * place of the Errored's content and the error at the Errored id. Hydrated
 * after every chunk is in, or from the shell with the rest applied later,
 * the client adopts the server's fallback node, asks nothing again, and
 * recovers once the read's input changes.
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
  preflushNested,
  preflushNestedAskCount,
  preflushNestedControl,
  preflushNestedName,
  preflushNestedShapes,
  type PreflushNestedShape
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

const recovered: Record<PreflushNestedShape, string> = {
  element: "titleuser:u8",
  sibling: "user:u8title",
  "settled-sibling": "sibuser:u8",
  "pending-sibling": "sibuser:u8"
};

async function run(shape: PreflushNestedShape, mode: "loaded" | "streamed") {
  const file = artifact(preflushNestedName(shape));
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  const App = preflushNested(shape);
  const failed = "failed: no user 7";
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrapHydrationGlobal();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const rejections: unknown[] = [];
  const onRejection = (r: unknown) => void rejections.push(r);
  process.on("unhandledRejection", onRejection);
  const asksBefore = preflushNestedAskCount();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    // The shell already shows the failure: the server drew it.
    const div = container.querySelector("div")!;
    const p = div.querySelector("p")!;
    expect(div.textContent).toBe(`${failed}outertail`);
    dispose = hydrate(() => <App />, container);
    await settle();
    if (mode === "streamed") {
      // The stream after the shell, one script at a time, as a browser
      // parses it: nothing in it changes what the page shows.
      for (const piece of rest.match(/[\s\S]*?<\/script>/g) ?? [rest]) {
        applyChunk(container, piece, false);
        await settle();
        expect(div.textContent).toBe(`${failed}outertail`);
      }
    }
    expect(container.querySelector("div")).toBe(div);
    expect(div.textContent).toBe(`${failed}outertail`);
    // The client adopted the server's fallback node and asked nothing again.
    expect(div.querySelectorAll("p").length).toBe(1);
    expect(div.querySelector("p")).toBe(p);
    expect(sharedConfig.isHydrationInProgress!()).toBe(false);
    expect(preflushNestedAskCount()).toBe(asksBefore);

    // The Errored tracks the read it adopted the failure of (#4273).
    preflushNestedControl.setKey!("u8");
    flush();
    await settle();
    expect(div.textContent).toBe(`${recovered[shape]}outertail`);
    expect(div.querySelector("p")).toBe(null);
    expect(preflushNestedAskCount()).toBe(asksBefore + 1);
    expect(warn).not.toHaveBeenCalled();
    await sleep(5);
    expect(rejections).toEqual([]);
  } finally {
    process.off("unhandledRejection", onRejection);
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

describe("#4287: a nested Loading failing before the shell, hydrated", () => {
  for (const shape of preflushNestedShapes) {
    test(`${shape}: hydrated after the stream`, () => run(shape, "loaded"));
    test(`${shape}: hydrated from the shell`, () => run(shape, "streamed"));
  }
});
