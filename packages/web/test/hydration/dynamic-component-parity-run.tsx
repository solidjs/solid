/**
 * @jsxImportSource @solidjs/web
 *
 * `dynamicComponent` — client half. Replays the artifacts
 * test/server/dynamic-component-parity.spec.tsx wrote (the page rendered
 * through the server `dynamicComponent`, asserted byte-identical to the
 * server `dynamic`'s) and hydrates with EITHER client entry point:
 * `dynamicComponent` (the documented server-component mount) and `dynamic`.
 * Either must adopt the document — no hydration key miss, the same nodes for
 * the client component, the frame and the article, the value memo's record
 * adopted (`computes === 1`, no request) — and both client slots must be
 * live after. One (variant, via) per spec file: the frames client's boundary
 * index and claim set are module state.
 */
import { expect, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { makeHost } from "../lifecycle-matrix/harness.js";
import {
  ARGS,
  artifactFor,
  fidFor,
  makeApp,
  type Variant,
  type Via
} from "../harness/dynamic-component-parity.jsx";
import { applyChunk, drain } from "./frame-live-document-helpers.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file))
    throw new Error(
      `Missing artifact "${name}" — run the server spec first: ` +
        `vitest run --config vite.config.server.mjs test/server/dynamic-component-parity.spec.tsx`
    );
  return JSON.parse(readFileSync(file, "utf-8"));
}

export async function runParity(variant: Variant, via: Via) {
  const FID = fidFor(variant);
  const { shell, rest } = loadArtifact(artifactFor(variant));
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { host } = makeHost();
  installServerComponents(host);

  const urls: string[] = [];
  vi.stubGlobal("fetch", async (input: any) => {
    urls.push(typeof input === "string" ? input : input.url);
    throw new Error("unexpected fetch");
  });

  const note = createServerReference(FID);
  let computes = 0;
  const App = makeApp(via, () => {
    computes++;
    return note(...ARGS);
  });

  const shown: string[] = [];
  const observe = () => {
    const text = container.querySelector("main")?.textContent ?? container.textContent!;
    if (shown[shown.length - 1] !== text) shown.push(text);
  };
  const mo = new MutationObserver(observe);

  applyChunk(container, shell, true);
  // `streamed`: the late fragment lands AFTER hydrate, below.
  if (variant === "inline") applyChunk(container, rest, false);
  mo.observe(container, { childList: true, subtree: true, characterData: true });
  observe();

  const nodes = () => ({
    panel: container.querySelector("#panel"),
    panelButton: container.querySelector("#panel-counter"),
    frame: container.querySelector(`solid-frame[data-fid="${FID}"]`),
    article: container.querySelector("#content"),
    h1: container.querySelector("h1"),
    noteButton: container.querySelector("#note-counter")
  });
  let before = nodes();
  expect(before.panel, "client component in the document").not.toBeNull();

  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });

  const dispose = hydrate(() => <App />, container);
  flush();
  await drain();
  observe();

  if (variant === "streamed") {
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("main")!.textContent).toContain("shell-fallback");
    applyChunk(container, rest, false);
    observe();
    await drain();
    observe();
    before = nodes();
  }

  await drain();
  observe();
  const after = nodes();

  console.log(`[${variant} via ${via}]`, {
    computes,
    urls,
    warnings,
    errors,
    shown,
    samePanel: after.panel === before.panel,
    sameFrame: after.frame === before.frame,
    sameArticle: after.article === before.article,
    sameH1: after.h1 === before.h1,
    html: container.innerHTML
  });

  expect(warnings.filter(w => w.includes("Hydration key miss"))).toEqual([]);
  expect(errors).toEqual([]);
  // The factory runs the source once (the hydration warm-up); the value
  // memo adopts the server's record and never re-runs it.
  expect(computes, "source runs once on the client").toBe(1);
  expect(urls, "no request left the browser").toEqual([]);
  // With the content in the document at hydration the boundary never
  // selects its fallback (in `streamed` the server's own fallback is
  // legitimately showing until the fragment lands).
  if (variant === "inline") expect(shown.some(t => t.includes("shell-fallback"))).toBe(false);
  expect(after.frame, "frame present").not.toBeNull();
  expect(after.h1!.textContent).toBe("note v1");
  expect(after.panel, "same client component node").toBe(before.panel);
  expect(after.panelButton, "same client button node").toBe(before.panelButton);
  expect(after.frame, "same frame node").toBe(before.frame);
  expect(after.article, "same article node").toBe(before.article);
  expect(after.h1, "same h1 node").toBe(before.h1);
  expect(container.querySelector("main")!.textContent).not.toContain("shell-fallback");

  // Interactivity: the client component's own state, and the client slot
  // inside the server component.
  (after.panelButton as HTMLButtonElement).click();
  flush();
  await drain();
  expect(container.querySelector("#panel-counter")!.textContent).toBe("Panel: 1");
  (after.noteButton as HTMLButtonElement).click();
  flush();
  await drain();
  expect(container.querySelector("#note-counter")!.textContent).toBe("Count: 1");
  expect(container.querySelector("#content")).toBe(after.article);
  expect(container.querySelector("#panel")).toBe(after.panel);

  mo.disconnect();
  dispose();
  container.remove();
}
