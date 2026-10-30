/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4372: an async read under a streamed `<Loading>` rejects and the error
 * escapes it to an `<Errored>` outside. The shell carries the Loading's
 * fallback; the fragment that follows carries the Errored's fallback
 * (`<template e>`) and the rejection. Hydrated after every chunk is in, or
 * from the shell with the chunk applied later (the client booting before the
 * server is done): either way the page shows the server's `[ERR]`, nothing
 * throws, reactivity stays up, and the client never asks again — it claims
 * the streamed error.
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
  erroredOutsideLoading,
  erroredOutsideLoadingAskCount,
  erroredOutsideLoadingName,
  erroredOutsideLoadingShapes,
  type ErroredOutsideLoadingShape
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

async function run(shape: ErroredOutsideLoadingShape, mode: "loaded" | "streamed") {
  const file = artifact(erroredOutsideLoadingName(shape));
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  const App = erroredOutsideLoading(shape);
  const container = document.createElement("div");
  document.body.appendChild(container);
  bootstrapHydrationGlobal();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // The fallback reads no error: dev logs the one it swallows.
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const rejections: unknown[] = [];
  const onRejection = (r: unknown) => void rejections.push(r);
  process.on("unhandledRejection", onRejection);
  const asksBefore = erroredOutsideLoadingAskCount();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    const main = container.querySelector("main")!;
    dispose = hydrate(() => <App />, container);
    await settle();
    if (mode === "streamed") {
      expect(main.textContent).toBe(shape === "sibling" ? "[LOAD]tail" : "[LOAD]");
      // The stream after the shell, one script at a time (a template rides
      // with the script after it), as a browser parses it.
      for (const piece of rest.match(/[\s\S]*?<\/script>/g) ?? [rest]) {
        applyChunk(container, piece, false);
        await settle();
      }
    }
    expect(container.querySelector("main")).toBe(main);
    expect(main.textContent).toBe(
      shape === "sibling" ? "[ERR]tail" : shape === "text" ? "!a" : "[ERR]"
    );
    // One node for the outcome: nothing of the swap or the clear is left
    // beside it.
    if (shape !== "sibling") expect(main.childNodes.length).toBe(1);
    expect(sharedConfig.isHydrationInProgress!()).toBe(false);
    // The client claimed the server's error: it never asked again.
    expect(erroredOutsideLoadingAskCount()).toBe(asksBefore);
    for (const c of logged.mock.calls) expect(String(c[0])).not.toMatch(/REACTIVITY_HALTED/);
    expect(warn).not.toHaveBeenCalled();
    await sleep(5);
    expect(rejections).toEqual([]);
  } finally {
    process.off("unhandledRejection", onRejection);
    warn.mockRestore();
    logged.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

describe("#4372: an Errored outside a streamed Loading catches the fragment's error", () => {
  for (const shape of erroredOutsideLoadingShapes) {
    test(`${shape}: hydrated after the failure arrived`, () => run(shape, "loaded"));
    test(`${shape}: hydrated before the failure arrived`, () => run(shape, "streamed"));
  }
});
