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
 * The client claims that markup in both replay orders, without warnings,
 * and asks nothing again: hydrated mid-stream, the outer resume reads the
 * memo a cycle after its error landed, and a resume re-serves the server's
 * answer — no ask, no flash back to a loading fallback.
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
import { createRenderEffect, createRoot, createSignal, flush, resetErrorHalt } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  scenarios,
  parkedHoleAskCount,
  fallbackHoleFailures,
  fallbackHoleFailure,
  fallbackHoleFailureName,
  parkedFailures,
  lateParkedFailures,
  parkedFailure,
  parkedFailureName,
  shellFallbackFailures,
  shellFallbackFailure,
  shellFallbackFailureName,
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

// An unrelated client write after each stream piece moves the reactive
// clock on, as on any live page.
const [tick, setTick] = createSignal(0);
createRoot(() => createRenderEffect(tick, () => {}));
const pieces = (rest: string) => rest.match(/[\s\S]*?<\/script>/g) ?? [rest];

async function run(name: string, mode: "loaded" | "streamed", before: string[]) {
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
      const seen: string[] = [container.textContent!];
      for (const piece of pieces(rest)) {
        applyChunk(container, piece, false);
        flush();
        await sleep(5);
        setTick(tick() + 1);
        flush();
        seen.push(container.textContent!);
      }
      for (let i = 0; i < 10; i++) {
        await sleep(5);
        flush();
        seen.push(container.textContent!);
      }
      // Placeholders until the fallback shows, and it stays once it shows.
      const at = seen.indexOf("outerfailed: no user 7 HINTtail");
      expect(at).toBeGreaterThan(0);
      expect(new Set(seen.slice(0, at))).toEqual(new Set(before));
      expect(new Set(seen.slice(at))).toEqual(new Set(["outerfailed: no user 7 HINTtail"]));
    }
    await sleep(50);
    flush();
    expect(container.textContent).toBe("outerfailed: no user 7 HINTtail");
    expect(container.querySelectorAll("p").length).toBe(1);
    if (mode === "loaded") expect(container.querySelector("p")).toBe(serverP);
    // The server's answer is used: nothing is asked again.
    expect(parkedHoleAskCount()).toBe(asksBefore);
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
  const outerLoading = ["outer loadingtail"];
  test("hole settles before the outer Loading, hydrated after the stream", () =>
    run(early, "loaded", outerLoading));
  test("hole settles before the outer Loading, hydrated mid-stream", () =>
    run(early, "streamed", outerLoading));
  test("hole settles after the outer Loading, hydrated after the stream", () =>
    run(late, "loaded", outerLoading));
  // The outer fragment carries the inner placeholder until the hole lands.
  test("hole settles after the outer Loading, hydrated mid-stream", () =>
    run(late, "streamed", [...outerLoading, "outerloadingtail"]));
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

const outcomeOf = (o: FallbackHoleFailure, mode: "loaded" | "streamed") =>
  replay(fallbackHoleFailureName(o), fallbackHoleFailure(o), mode, "h2");

async function replay(
  name: string,
  App: () => any,
  mode: "loaded" | "streamed",
  claim: string
): Promise<Outcome> {
  const file = artifact(name);
  expect(existsSync(file)).toBe(true);
  const { shell, rest } = JSON.parse(readFileSync(file, "utf-8"));
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
    const serverH2 = container.querySelector(claim);
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
      claimed: !!serverH2 && container.querySelector(claim) === serverH2
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

// The #4316 follow-up: a fragment failing while parked in a pending
// enclosing fragment ends as its twin, the same failure met in the
// enclosing fragment's own pass: the client claims the fallback the
// server drew there (an `<Errored>` between, else the outermost one the
// failed enclosing fragment is all of), or, with none, renders the failed
// fragment fresh. Hydration ids differ (the twin has no inner Loading), so
// the server's page is compared as text. Uncontained, the page halts on
// the client's own rejection: the text it froze at is the client tree's
// (the inner `<Loading>` shows its fallback, the twin's the outer's), so
// what is compared is that it halted and on what. Warnings are compared
// too: the streamed twin with an `<Errored>` around a pending read used to
// miss its fallback key while it hydrated the pending fragment (the core's
// retry of the errored read, once the fragment released, was taken for a
// client write and refetched); the served pass keeps that read latched.
describe("#4316: a fragment failing while parked in a pending fragment", () => {
  const comparable = (r: Outcome) => ({
    ...r,
    server: r.server === undefined ? undefined : textOfHtml(r.server),
    text: r.halted ? undefined : r.text,
    uncaught: [...new Set(r.uncaught)]
  });
  for (const o of parkedFailures) {
    if (o.variant !== "inner") continue;
    const claim = o.A ? "h2" : "h3";
    for (const mode of ["loaded", "streamed"] as const) {
      test(`${parkedFailureName(o)} [${mode}] ends as its twin`, async () => {
        const twinOf = { ...o, variant: "twin" as const };
        const outcome = await replay(parkedFailureName(o), parkedFailure(o), mode, claim);
        const twin = await replay(parkedFailureName(twinOf), parkedFailure(twinOf), mode, claim);
        expect(comparable(outcome)).toEqual(comparable(twin));
        if (o.A || o.caught) {
          const message = o.B ? "no hint" : "no user 7";
          expect(outcome.text).toBe(`${o.A ? "outercaught" : "outermost"}: ${message}tail`);
          expect(outcome.halted).toBe(false);
          expect(outcome.warnings).toBe(0);
          expect(outcome.uncaught).toEqual([]);
          if (mode === "loaded") expect(outcome.claimed).toBe(true);
        }
      });
    }
  }
  // Settled first, the enclosing fragment's markup was out before the inner
  // read failed: its fragment rejects on its own and the client renders it,
  // where its own `<Errored>` meets the failure.
  for (const o of lateParkedFailures) {
    for (const mode of ["loaded", "streamed"] as const) {
      test(`${parkedFailureName(o)} [${mode}] is the client's to render`, async () => {
        const outcome = await replay(parkedFailureName(o), parkedFailure(o), mode, "h2");
        if (o.A) {
          expect(outcome.text).toBe("outercaught: no user 7tail");
          expect(outcome.halted).toBe(false);
          expect(outcome.uncaught).toEqual([]);
          expect(outcome.done).toBe(true);
        } else {
          // Nothing on the client catches it: the fresh render adopts the
          // server's error (no ask) and it is uncaught, as on the server, so
          // reactivity halts; the boundary has resumed all the same, so
          // hydration completes (as #4242's uncontained variants).
          expect(outcome.uncaught).toContain("no user 7");
          expect(outcome.halted).toBe(true);
          expect(outcome.done).toBe(true);
        }
      });
    }
  }
});

// The same failure at shell level, no `<Loading>`: the outer `<Errored>`
// caught B's fallback's failure on the server; the client claims its
// fallback, ending as the sync-throw twin.
describe("#4316: the Errored fallback's own hole fails in the shell", () => {
  for (const o of shellFallbackFailures) {
    if (o.hole !== "async" || !o.A) continue;
    for (const mode of ["loaded", "streamed"] as const) {
      test(`${shellFallbackFailureName(o)} [${mode}] ends as its sync-throw twin`, async () => {
        const twinOf = { ...o, hole: "sync" as const };
        const outcome = await replay(
          shellFallbackFailureName(o),
          shellFallbackFailure(o),
          mode,
          "h2"
        );
        const twin = await replay(
          shellFallbackFailureName(twinOf),
          shellFallbackFailure(twinOf),
          mode,
          "h2"
        );
        expect(outcome).toEqual(twin);
        expect(outcome.text).toBe("caught: no hintoutertail");
        expect(outcome.halted).toBe(false);
        expect(outcome.warnings).toBe(0);
        expect(outcome.uncaught).toEqual([]);
        expect(outcome.claimed).toBe(true);
      });
    }
  }
});

function textOfHtml(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  el.querySelectorAll("template").forEach(t => t.remove());
  return el.textContent;
}
