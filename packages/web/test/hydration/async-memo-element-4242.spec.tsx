/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Hydrate half of the #4242 remainder (see test/harness/async-memo-element-
 * 4242.tsx): replays the artifacts test/server/async-memo-element-4242
 * .spec.tsx writes, with the whole document present before hydration
 * (`loaded`) and with the post-shell chunks arriving after it (`streamed`).
 *
 * Before the fix the client either waited forever on the refused memo's key
 * (the boundary never hydrated, or reverted to its fallback once streamed)
 * or was handed markup as data (`UNRECOGNIZED_INSERT_VALUE`). Now:
 *  - inside an `<Errored>`, the client hydrates the fallback the server
 *    rendered for the refusal and hydration completes;
 *  - uncontained, the client does exactly what it does for any other
 *    server render error at that position (the `-reference` twin): the
 *    rejected fragment's fresh render adopts the server's error instead of
 *    asking again, and with no client boundary to catch it, it is an
 *    uncaught error;
 *  - ordinary data lands, is adopted without the client recomputing it, and
 *    the page is interactive.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { control, DATA_TEXT, variants, type Variant } from "../harness/async-memo-element-4242.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact "${name}". Run the server half first (test/server/async-memo-element-4242.spec.tsx).`
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
const RealPromise = Promise;
const sleep = (ms: number) => new RealPromise<void>(r => setTimeout(r, ms));
async function drain() {
  for (let i = 0; i < 40; i++) await RealPromise.resolve();
  flush();
  for (let i = 0; i < 40; i++) await RealPromise.resolve();
  flush();
}
const original = { ...control };
afterEach(() => Object.assign(control, original));

type Mode = "loaded" | "streamed";
type Outcome = {
  /** Text content after the click, `<template>`s (unadopted fragments) excluded. */
  text: string;
  /** Each distinct text the container showed, in order. */
  shown: string[];
  /** Memo computes the client really ran (not its hydration dry runs). */
  runs: string[];
  afterClick: string | undefined;
  done: boolean;
  halted: boolean;
  warnings: string[];
  errors: string[];
  rejections: string[];
};

async function run(name: string, App: () => any, mode: Mode): Promise<Outcome> {
  const { shell, rest } = loadArtifact(name);
  const runs: string[] = [];
  control.log = (w: string) => {
    // The client's hydration dry run computes under a mock Promise.
    if (Promise === RealPromise) runs.push(w);
  };
  control.wait = () => sleep(1);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const warnings: string[] = [];
  const errors: string[] = [];
  const rejections: string[] = [];
  const onRejection = (r: unknown) => void rejections.push(String(r));
  process.on("unhandledRejection", onRejection);
  const w = vi
    .spyOn(console, "warn")
    .mockImplementation((...a: unknown[]) => void warnings.push(a.map(String).join(" ")));
  const e = vi
    .spyOn(console, "error")
    .mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(" ")));
  const textOf = () => {
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("template").forEach(t => t.remove());
    return clone.textContent!.trim();
  };
  const shown: string[] = [];
  const observe = () => {
    const t = textOf();
    if (shown[shown.length - 1] !== t) shown.push(t);
  };
  const mo = new MutationObserver(observe);
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    mo.observe(container, { childList: true, subtree: true, characterData: true });
    observe();
    dispose = hydrate(() => <App />, container);
    flush();
    await drain();
    if (mode === "streamed") {
      applyChunk(container, rest, false);
      await drain();
    }
    await sleep(20);
    await drain();
    observe();
    container.querySelector<HTMLButtonElement>("#counter")?.click();
    flush();
    await drain();
    // Unhandled rejections are reported a macrotask after the fact.
    await sleep(5);
    observe();
    return {
      text: textOf(),
      shown,
      runs,
      afterClick: container.querySelector("#counter")?.textContent ?? undefined,
      done: !!(globalThis as any)._$HY.done,
      halted: errors.some(m => m.includes("[REACTIVITY_HALTED]")),
      warnings,
      errors,
      rejections
    };
  } finally {
    process.off("unhandledRejection", onRejection);
    mo.disconnect();
    w.mockRestore();
    e.mockRestore();
    dispose?.();
    container.remove();
  }
}

const byName = new Map(variants.map(v => [v.name, v]));
const modes = (v: Variant): Mode[] =>
  v.timing === "streamed" ? ["loaded", "streamed"] : ["loaded"];

describe("async memo resolving to rendered output (#4242) — hydration", () => {
  for (const variant of variants) {
    if (variant.reference) continue;
    for (const mode of modes(variant)) {
      test(`${variant.name} [${mode}]`, async () => {
        const outcome = await run(variant.name, variant.App, mode);
        // Rejections a hydrating client reports are the server's refused
        // record (an error record nothing on the client consumes), never a
        // failure of its own.
        for (const r of outcome.rejections) expect(r).toContain("[ASYNC_MEMO_ELEMENT]");
        expect(outcome.errors.join("\n")).not.toContain("UNRECOGNIZED_INSERT_VALUE");

        if (variant.shape === "data") {
          // Adopted, not recomputed: the records crossed as the values.
          expect(outcome.runs).toEqual([]);
          expect(outcome.text).toBe(DATA_TEXT + "Count: 1");
          expect(outcome.afterClick).toBe("Count: 1");
          expect(outcome.shown).toEqual(
            mode === "streamed"
              ? ["loading", DATA_TEXT + "Count: 0", DATA_TEXT + "Count: 1"]
              : [DATA_TEXT + "Count: 0", DATA_TEXT + "Count: 1"]
          );
          expect(outcome.done).toBe(true);
          expect(outcome.warnings).toEqual([]);
          expect(outcome.errors).toEqual([]);
          expect(outcome.rejections).toEqual([]);
          return;
        }

        if (variant.errored) {
          // The <Errored> caught the refusal on the server and the client
          // hydrates its fallback: it settles there and stays there.
          const caught =
            variant.shape === "jsx" ? "ASYNC_MEMO_ELEMENT" : "caught:ASYNC_MEMO_ELEMENT";
          expect(outcome.text).toBe(caught);
          expect(outcome.shown[outcome.shown.length - 1]).toBe(caught);
          expect(outcome.shown.slice(0, -1).every(t => t === "outer")).toBe(true);
          expect(outcome.done).toBe(true);
          expect(outcome.halted).toBe(false);
          expect(outcome.errors).toEqual([]);
          return;
        }

        // Uncontained: exactly what any server render error at this
        // position does — the reference twin's outcome.
        const twin = byName.get(`${variant.name}-reference`)!;
        const reference = await run(twin.name, twin.App, mode);
        const comparable = (o: Outcome) => ({
          text: o.text,
          shown: o.shown,
          runs: o.runs,
          afterClick: o.afterClick,
          done: o.done,
          halted: o.halted,
          rejections: o.rejections.length
        });
        expect(comparable(outcome)).toEqual(comparable(reference));
        // The fragment rejected with no outcome: the client renders it
        // fresh, adopting what the server sent — the memo's error, never
        // asked for again (hydration never refetches). Nothing on the client
        // catches it (a <Loading> does not), so it is an uncaught error, as
        // on any client render: the reactive system halts, the element
        // never renders (no counter to click), and the halted resume never
        // completes hydration. Recovery is a real input change or a reset()
        // of a client boundary, as for any hydrated failure (#4273).
        for (const o of [outcome, reference]) {
          // `outer` adopted the server's answer. The issue shape's `inner`
          // run is the fixture's own: the hydration dry run of `outer` only
          // subscribes, but its continuation waits on a real timer (the
          // fixture's wait escapes the dry run's mock Promise) and builds
          // the inner slot, whose memo has no owner id to hydrate by.
          expect(o.runs).toEqual(variant.shape === "jsx" ? [] : ["inner"]);
          expect(o.halted).toBe(true);
          expect(o.done).toBe(false);
          expect(o.text).toBe("");
          expect(o.afterClick).toBe(undefined);
          expect(o.shown).toEqual(mode === "streamed" ? ["outer", ""] : [""]);
        }
      });
    }
  }
});
