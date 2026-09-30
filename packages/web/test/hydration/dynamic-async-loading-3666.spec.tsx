/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * solidjs/solid#3666: an async `dynamic()` inside `<Loading>`. Replays the
 * artifacts test/server/dynamic-async-loading-3666.spec.tsx writes:
 *
 *  - loaded: every chunk before hydrate() — the issue's timeline (the client
 *    entry is held until the resolved `<article>` is visible). The boundary
 *    must adopt the server article, keep node identity, and never try to
 *    claim the fallback.
 *  - streamed (streaming variant only): shell, hydrate, then the late chunk
 *    — the fallback IS the right UI until the fragment lands, then the
 *    article is adopted.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { control, variants } from "../harness/dynamic-async-loading-3666.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

function loadArtifact(n: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${n}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact "${n}". Run the server spec first: ` +
        `vitest run --config vite.config.server.mjs test/server/dynamic-async-loading-3666.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

async function drain() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  flush();
  for (let i = 0; i < 40; i++) await Promise.resolve();
  flush();
}

const RealPromise = Promise;
const originalControl = { ...control };
afterEach(() => {
  Object.assign(control, originalControl);
});

type Variant = (typeof variants)[number];

async function run(variant: Variant, mode: "streamed" | "loaded") {
  const { shell, rest } = loadArtifact(variant.name);

  // On the client the source is gated so every step is observed
  // deterministically; count only runs under the real Promise (the adoption
  // pass may trace under a MockPromise swap).
  let sourceRuns = 0;
  let release!: () => void;
  const gate = new RealPromise<"article">(r => (release = () => r("article")));
  const gated = () => {
    if (Promise === RealPromise) sourceRuns++;
    return gate;
  };
  control.inline = gated;
  control.streamed = gated;

  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const warnings: string[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });

  const shown: string[] = [];
  const observe = () => {
    const text = container.textContent!;
    if (shown[shown.length - 1] !== text) shown.push(text);
  };
  const mo = new MutationObserver(observe);

  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    mo.observe(container, { childList: true, subtree: true, characterData: true });
    observe();

    let serverArticle = container.querySelector("#content");
    if (mode === "loaded") {
      expect(serverArticle, "server article is in the DOM before hydrate").not.toBeNull();
    }

    dispose = hydrate(() => <variant.App />, container);
    flush();
    await drain();
    observe();

    if (mode === "streamed") {
      expect(container.querySelector("#fallback"), "fallback showing pre-fragment").not.toBeNull();
      applyChunk(container, rest, false);
      serverArticle = container.querySelector("#content");
      expect(serverArticle, "server article landed").not.toBeNull();
      await drain();
      observe();
    }

    const beforeRelease = {
      warnings: [...warnings],
      html: container.innerHTML,
      sameNode: container.querySelector("#content") === serverArticle,
      fallback: container.querySelector("#fallback") !== null,
      sourceRuns
    };

    // Let the client source settle.
    release();
    await drain();
    observe();

    console.log(`[${variant.name} ${mode}] before release:`, beforeRelease);
    console.log(`[${variant.name} ${mode}] after release:`, {
      warnings,
      html: container.innerHTML,
      sameNode: container.querySelector("#content") === serverArticle,
      fallback: container.querySelector("#fallback") !== null,
      sourceRuns,
      shown
    });

    expect(
      warnings.filter(w => w.includes("Hydration key miss")),
      "no hydration key miss"
    ).toEqual([]);
    expect(container.querySelector("#fallback"), "fallback not in the DOM").toBeNull();
    expect(container.querySelector("#content"), "server article adopted (same node)").toBe(
      serverArticle
    );

    // Interactivity: click the counter; the SAME article must remain.
    const button = container.querySelector<HTMLButtonElement>("#counter")!;
    expect(button).not.toBeNull();
    button.click();
    flush();
    await drain();
    expect(container.querySelector("#counter")!.textContent).toBe("Count: 1");
    expect(container.querySelector("#content"), "article survives the click").toBe(serverArticle);
    expect(warnings, "no warnings at all").toEqual([]);
  } finally {
    mo.disconnect();
    warn.mockRestore();
    dispose?.();
    release();
    await new Promise(r => setTimeout(r, 0));
    container.remove();
  }
}

describe("async dynamic() inside Loading adopts the SSR article (#3666)", () => {
  for (const variant of variants) {
    const modes = variant.streams ? (["loaded", "streamed"] as const) : (["loaded"] as const);
    for (const mode of modes) {
      test(`${variant.name} [${mode}]`, () => run(variant, mode));
    }
  }
});
