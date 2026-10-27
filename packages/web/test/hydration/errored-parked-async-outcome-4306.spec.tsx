/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4306: `<Errored>` with an async hole in its fallback, around a
 * `<Loading>` whose read fails after the shell, inside an outer `<Loading>`
 * still pending when it fails. The failure waits out the fallback's hole
 * (RULES-DERIVED D-18), so the server sends the finished fallback (and the
 * error record at the Errored id):
 *
 * - hole settled before the outer Loading: inside the outer fragment;
 * - hole settled after it: the outer fragment carries the inner
 *   placeholder, and the inner fragment streams the fallback.
 *
 * The client claims that markup in both replay orders, without warnings;
 * hydrated after the stream it asks nothing again.
 *
 * #4316: the same shapes (parked or not, an outer `<Errored>` or none) with
 * the fallback's own hole failing — rejecting while the failure waits for
 * it. The failure is the next boundary up's, as when the fallback throws
 * synchronously: the async variant ends exactly as its sync-throw twin,
 * the server's markup and the client's outcome alike; caught, the client
 * claims the outer `<Errored>`'s fallback the server drew.
 *
 * Replays the parity harness artifacts (test/server/hydration-harness.spec.tsx).
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush, resetErrorHalt } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  scenarios,
  parkedHoleAskCount,
  fallbackHoleFailures,
  fallbackHoleFailure,
  fallbackHoleFailureName,
  type FallbackHoleFailure
} from "../harness/scenarios.jsx";

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

async function run(name: string, mode: "loaded" | "streamed") {
  const file = artifact(name);
  const scenario = scenarios.find(s => s.name === name)!;
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  // The server sends the finished fallback and the error record with it.
  expect(rest).toContain("HINT<!--/--></p>");
  expect(rest).toContain('_$HY.r["4002"]');
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const asksBefore = parkedHoleAskCount();
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    const serverP = container.querySelector("p");
    dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();
    if (mode === "streamed") {
      expect(container.textContent).toBe("outer loadingtail");
      applyChunk(container, rest, false);
    }
    await sleep(50);
    flush();
    expect(container.textContent).toBe("outerfailed: no user 7 HINTtail");
    expect(container.querySelectorAll("p").length).toBe(1);
    if (mode === "loaded") expect(container.querySelector("p")).toBe(serverP);
    // The server's answer is used: nothing is asked again. (Hydrated
    // mid-stream, the memo re-asks on the outer boundary's resume, as for
    // the parked failure with a plain fallback — see the scenario notes.)
    expect(parkedHoleAskCount()).toBe(asksBefore + (mode === "streamed" ? 1 : 0));
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

const early = "errored-loading-parked-rejection-async-fallback-4306";
const late = "errored-loading-parked-rejection-late-async-fallback-4306";

describe("#4306: parked failure, Errored fallback with an async hole", () => {
  test("hole settles before the outer Loading, hydrated after the stream", () =>
    run(early, "loaded"));
  test("hole settles before the outer Loading, hydrated mid-stream", () => run(early, "streamed"));
  test("hole settles after the outer Loading, hydrated after the stream", () =>
    run(late, "loaded"));
  test("hole settles after the outer Loading, hydrated mid-stream", () => run(late, "streamed"));
});

type Outcome = {
  /** The page the server's stream builds, before anything hydrates (loaded). */
  server: string | undefined;
  text: string;
  halted: boolean;
  done: boolean;
  warnings: number;
  /** What reached the page's uncaught-error channel (`reportError`). */
  uncaught: string[];
  /** In loaded mode: the client kept the server's outer-fallback node. */
  claimed: boolean;
};

async function outcomeOf(o: FallbackHoleFailure, mode: "loaded" | "streamed"): Promise<Outcome> {
  const name = fallbackHoleFailureName(o);
  const file = artifact(name);
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
  const App = fallbackHoleFailure(o);
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errors: string[] = [];
  const error = vi
    .spyOn(console, "error")
    .mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(" ")));
  // An uncontained failure halts the page: own its uncaught channels (the
  // platform's `reportError`, and the process's for the rethrow out of a
  // scheduled flush) so what escapes is part of the outcome.
  const uncaught: string[] = [];
  const report = (e: unknown) => void uncaught.push(e instanceof Error ? e.message : String(e));
  vi.stubGlobal("reportError", report);
  const events = ["uncaughtException", "unhandledRejection"] as const;
  const previous = events.map(e => process.listeners(e));
  events.forEach(e => (process.removeAllListeners(e), process.on(e, report)));
  resetErrorHalt();
  const textOf = () => {
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("template").forEach(t => t.remove());
    return clone.textContent!;
  };
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    const server = mode === "loaded" ? container.innerHTML : undefined;
    const serverH2 = container.querySelector("h2");
    try {
      dispose = hydrate(() => <App />, container);
    } catch {}
    flush();
    await sleep(10);
    flush();
    if (mode === "streamed") applyChunk(container, rest, false);
    await sleep(50);
    flush();
    await sleep(10);
    return {
      server,
      text: textOf(),
      halted: errors.some(m => m.includes("[REACTIVITY_HALTED]")),
      done: !!(globalThis as any)._$HY.done,
      warnings: warn.mock.calls.length,
      uncaught,
      claimed: !!serverH2 && container.querySelector("h2") === serverH2
    };
  } finally {
    try {
      dispose?.();
    } catch {}
    await sleep(0);
    container.remove();
    events.forEach((e, i) => {
      process.off(e, report);
      for (const listener of previous[i]) process.on(e, listener as any);
    });
    vi.unstubAllGlobals();
    warn.mockRestore();
    error.mockRestore();
    resetErrorHalt();
  }
}

describe("#4316: the Errored fallback's own hole fails", () => {
  for (const o of fallbackHoleFailures) {
    if (o.hole !== "async") continue;
    for (const mode of ["loaded", "streamed"] as const) {
      test(`${fallbackHoleFailureName(o)} [${mode}] ends as its sync-throw twin`, async () => {
        const outcome = await outcomeOf(o, mode);
        const twin = await outcomeOf({ ...o, hole: "sync" }, mode);
        // A halted page's later notices (how often the halt is reported,
        // what it refuses after) are the halt's, not the outcome's: the
        // comparison takes which errors escaped, and warnings while live.
        const comparable = (r: Outcome) => ({
          ...r,
          uncaught: [...new Set(r.uncaught)],
          warnings: r.halted ? undefined : r.warnings
        });
        expect(comparable(outcome)).toEqual(comparable(twin));
        if (o.caught) {
          // The outer Errored caught it on the server: the client claims
          // its fallback and the page stays live.
          expect(outcome.text).toBe("caught: no hinttail");
          expect(outcome.halted).toBe(false);
          expect(outcome.warnings).toBe(0);
          if (mode === "loaded") expect(outcome.claimed).toBe(true);
        }
      });
    }
  }
});
