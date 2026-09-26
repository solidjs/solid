/**
 * @jsxImportSource @solidjs/web
 *
 * #3666 follow-up — client half. Replays the artifacts
 * test/server/frame-nonlive-document-3666.spec.tsx wrote and hydrates with
 * the CLIENT's source: a plain (non-live) server reference. Since #3666 the
 * instance's value memo is an ordinary async memo: the server serialized its
 * landing (the call's binding, as a flight reference) and the client memo at
 * the same id ADOPTS that record during hydration — it never waits on the
 * source, so the boundary never selects its fallback and the SSR'd nodes are
 * adopted, however the source answers (sync intercept hit, a promise of it,
 * an `async` arrow). The factory memo still runs the source once (its
 * hydration warm-up), which the frames intercept answers from the document
 * without a request — `computes === 1`, `urls` empty.
 */
import { expect, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { makeHost } from "../lifecycle-matrix/harness.js";
import { ARGS, fidFor, makeApp, type Variant } from "../harness/frame-nonlive-document-3666.jsx";
import { applyChunk, drain } from "./frame-live-document-helpers.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file)) throw new Error(`Missing artifact "${name}" — run the server spec first`);
  return JSON.parse(readFileSync(file, "utf-8"));
}

// `wrap`: the client source hands the intercept's synchronous answer back
// inside a promise — what any async wrapper around the server reference does:
// `"resolve"` models @solidjs/router's `query()` (its `handleResponse` is an
// `async` function, so `query(fn)()` is always a promise), `"async"` a user's
// `async () => await getNote(id)` arrow. Since #3666 the instance's memo
// adopts the server's record, so the wrapper is irrelevant to hydration: no
// pending beat, no fallback, same nodes.
export type Wrap = false | "resolve" | "async";
export async function runNonLive(
  variant: Variant,
  mode: "loaded" | "streamed",
  wrap: Wrap = false
) {
  const FID = fidFor(variant, mode);
  const { shell, rest } = loadArtifact(`frame-nonlive-document-3666-${variant}-${mode}`);
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
  const App = makeApp(
    wrap === "async"
      ? async () => {
          computes++;
          return await note(...ARGS);
        }
      : () => {
          computes++;
          const hit = note(...ARGS);
          return wrap ? Promise.resolve(hit) : hit;
        }
  );

  const shown: string[] = [];
  const observe = () => {
    const text = container.querySelector("main")?.textContent ?? container.textContent!;
    if (shown[shown.length - 1] !== text) shown.push(text);
  };
  const mo = new MutationObserver(observe);

  applyChunk(container, shell, true);
  if (mode === "loaded") applyChunk(container, rest, false);
  mo.observe(container, { childList: true, subtree: true, characterData: true });
  observe();

  const before = {
    frame: container.querySelector(`solid-frame[data-fid="${FID}"]`),
    article: container.querySelector("#content"),
    h1: container.querySelector("h1"),
    button: container.querySelector("#counter")
  };

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

  if (mode === "streamed") {
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("main")!.textContent).toBe("shell-fallback");
    applyChunk(container, rest, false);
    observe();
    await drain();
    observe();
    before.frame = container.querySelector(`solid-frame[data-fid="${FID}"]`);
    before.article = container.querySelector("#content");
    before.h1 = container.querySelector("h1");
    before.button = container.querySelector("#counter");
  }

  await drain();
  observe();

  const frameEl = container.querySelector(`solid-frame[data-fid="${FID}"]`);
  const article = container.querySelector("#content");
  const h1 = container.querySelector("h1");
  const button = container.querySelector<HTMLButtonElement>("#counter");

  console.log(`[${variant} ${mode}${wrap ? ` wrapped:${wrap}` : ""}]`, {
    computes,
    urls,
    warnings,
    errors,
    shown,
    sameFrame: frameEl === before.frame,
    sameArticle: article === before.article,
    sameH1: h1 === before.h1,
    sameButton: button === before.button,
    html: container.innerHTML
  });

  expect(warnings.filter(w => w.includes("Hydration key miss"))).toEqual([]);
  expect(errors).toEqual([]);
  // The factory runs the source once (the hydration warm-up); the value
  // memo's trace reads that memo, and adoption never re-runs it.
  expect(computes, "source runs once on the client").toBe(1);
  expect(urls, "no request left the browser").toEqual([]);
  // With the content in the document at hydration the boundary never
  // selects its fallback: nothing but the content was ever on screen. (In
  // `streamed` mode the server's own fallback is legitimately showing until
  // the boundary lands.)
  if (mode === "loaded") expect(shown.some(t => t.includes("shell-fallback"))).toBe(false);
  expect(frameEl, "frame present").not.toBeNull();
  expect(h1!.textContent).toBe("note v1");
  expect(frameEl, "same frame node").toBe(before.frame);
  expect(article, "same article node").toBe(before.article);
  expect(h1, "same h1 node").toBe(before.h1);
  expect(container.querySelector("main")!.textContent).not.toContain("shell-fallback");

  // Interactivity through the client slot.
  button!.click();
  flush();
  await drain();
  expect(container.querySelector("#counter")!.textContent).toBe("Count: 1");
  expect(container.querySelector("#content")).toBe(article);

  mo.disconnect();
  dispose();
  container.remove();
}
