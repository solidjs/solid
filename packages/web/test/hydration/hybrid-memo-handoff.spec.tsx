/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The memo-shaped twin of solidjs/solid#3574: an `ssrSource: "hybrid"`
 * `createMemo` / function-form `createSignal` over an async generator, read
 * by a STREAMED `<Loading>`. The server's late chunk resolves the node's
 * answer, then reveals the fragment, then settles the boundary's `_fr`
 * record. The client's takeover (hydrateSignalLike, #2993) re-runs the
 * generator; its first yield duplicates the answer already in the node and
 * must not re-open a pending window meanwhile — the boundary created at
 * resume would select its fallback and try to claim it against the resolved
 * fragment:
 *
 *   Hydration key miss for "210": no server-rendered element carries this key
 *   (template: <span>loading)
 *
 * with the server span replaced instead of claimed and a second "loading"
 * between the two content states. The value-shaped takeover had a WIDER
 * window than the store's (#3574): its gate flipped at creation, so the
 * client generator started as a fresh flight before the server answer
 * landed — pending from creation until the client's first yield — and that
 * run superseded the server flight (the #3499 shape #3551 fixed for stores).
 *
 * The contract this pins is #3551's, as #3593 pinned it for stores: the
 * server consumes exactly one yield and the client continues the iteration —
 * the handoff waits for the answer to LAND, the adopted answer is step 0, the
 * client's first yield its duplicate, and a stream is not pending between
 * yields. Maintainer ruling: `isPending` does not read true over the initial
 * load; the handoff is its tail.
 *
 * Promise-shaped hybrid memos/signals do not hand off at the landing (#2993:
 * adopting the serialized value is their semantics — a handoff would refetch
 * on the client); they are pinned here so the two shapes keep agreeing on
 * the observable outcome (no key miss, no flash, the server span claimed).
 * Whether they re-run once hydration is DONE is readSerializedOrCompute's
 * pre-existing behavior, outside the handoff contract, and not asserted.
 *
 * Replays the chunk artifacts test/server/hybrid-memo-handoff.spec.tsx
 * writes, with the fixture's await points swapped for gates, in both replay
 * modes of the parity harness:
 *
 *  - streamed: shell, hydrate, then the late chunk while the source is held —
 *    the issue's timeline. Before the chunk the fallback IS the right UI (the
 *    server answer is still pending); it must stay until the answer lands.
 *  - loaded: every chunk before hydrate() — the settled-answer handoff, which
 *    flips at creation; pinned so the two paths keep agreeing.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { control, variants } from "../harness/hybrid-memo-handoff.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact "${name}". Run the server spec first: ` +
        `vitest run --config vite.config.server.mjs test/server/hybrid-memo-handoff.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

// Split a chunk into markup and inline scripts, apply the markup, then eval
// the scripts — what a streaming browser parse does (parity-harness.spec).
function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
}

// Every step of the handoff is a microtask chain (landing → asyncWrite →
// next pull → flip → flush → resume). Drain generously; nothing here is on a
// timer.
async function drain() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  flush();
  for (let i = 0; i < 40; i++) await Promise.resolve();
  flush();
}

type Variant = (typeof variants)[number];

const RealPromise = Promise;
const originalControl = { ...control };

afterEach(() => {
  Object.assign(control, originalControl);
});

async function run(variant: Variant, mode: "streamed" | "loaded") {
  const { shell, rest } = loadArtifact(variant.name);

  // The fixture's await points, gated. The adoption pass also runs the
  // source once as a TRACE under a MockPromise swap of the global (subFetch);
  // that run is never consumed, so its gates must never open — hand it a
  // promise that never settles and count only real starts.
  const gates = [deferred(), deferred()];
  let starts = 0;
  const never = () => new RealPromise<void>(() => {});
  control.first = () => (Promise === RealPromise ? gates[0].promise : never());
  control.second = () => (Promise === RealPromise ? gates[1].promise : never());
  control.onStart = () => {
    if (Promise === RealPromise) starts++;
  };
  // Generator-shaped sources hand off to the client iteration once the
  // answer lands — exactly one start, exactly then. Promise-shaped sources
  // have no handoff (#2993); their start count is not part of the contract.
  const expectStarts = (n: number, message: string) => {
    if (variant.takeover) expect(starts, message).toBe(n);
  };

  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const warnings: string[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });

  // Every distinct text the section shows, in order — the flash the issue
  // reports is a second "loading" between the two content states.
  const shown: string[] = [];
  const observe = () => {
    const text = container.querySelector("section")!.textContent!;
    if (shown[shown.length - 1] !== text) shown.push(text);
  };
  const mo = new MutationObserver(observe);

  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded") applyChunk(container, rest, false);
    mo.observe(container, { childList: true, subtree: true, characterData: true });
    observe();

    dispose = hydrate(() => <variant.App />, container);
    flush();
    await drain();
    observe();

    if (mode === "streamed") {
      // The server answer is still pending: the fallback is legitimately
      // on screen, and the client source has not started (rule 1 — the
      // handoff waits for the answer to land, never runs ahead of it; the
      // server flight is not superseded before it lands).
      expect(container.querySelector("section")!.textContent).toBe("loading");
      expectStarts(0, "the client source must not start before the answer lands");

      // The late chunk: answer resolver → $df fragment swap → _fr resolver.
      applyChunk(container, rest, false);
      observe();
    }

    const serverSpan = container.querySelector("span[_hk='2000']")!;
    expect(serverSpan, "the server-rendered content span is in the DOM").not.toBeNull();
    expect(serverSpan.textContent).toBe("true:0");

    // Landing → handoff → boundary resume, all on microtasks.
    await drain();
    observe();

    // The boundary resumed against the resolved fragment: it claimed the
    // server span (same node, not re-created) and shows the adopted answer.
    // The handoff run has started — its duplicate first step is what must
    // not have shown the fallback again. (In loaded mode the fragment was
    // swapped in before hydration, so the first text seen is the content.)
    const settled = mode === "streamed" ? ["loading", "true:0"] : ["true:0"];
    expect(
      warnings.filter(w => w.includes("Hydration key miss")),
      "no hydration key miss"
    ).toEqual([]);
    expectStarts(1, "the handoff run started once the answer landed");
    expect(container.querySelector("section")!.textContent).toBe("true:0");
    expect(container.querySelector("span[_hk='2000']"), "server span claimed, not replaced").toBe(
      serverSpan
    );
    expect(shown).toEqual(settled);

    // The client source's first yield: the duplicate, discarded silently.
    gates[0].release();
    await drain();
    observe();
    expect(container.querySelector("section")!.textContent).toBe(variant.steps[0]);
    expect(container.querySelector("span[_hk='2000']")).toBe(serverSpan);
    expect(shown).toEqual(settled);

    // Later steps (generator only) update the claimed DOM in place.
    if (variant.steps.length > 1) {
      gates[1].release();
      await drain();
      observe();
      expect(container.querySelector("section")!.textContent).toBe(variant.steps[1]);
      expect(container.querySelector("span[_hk='2000']")).toBe(serverSpan);
      expect(shown).toEqual([...settled, variant.steps[1]]);
    }

    expectStarts(1, "no further client runs");
    expect(warnings, "no warnings at all").toEqual([]);
  } finally {
    mo.disconnect();
    warn.mockRestore();
    dispose?.();
    for (const g of gates) g.release();
    await new Promise(r => setTimeout(r, 0));
    container.remove();
  }
}

describe("hybrid memo/signal handoff vs streamed <Loading> claim (memo-shaped #3574)", () => {
  for (const variant of variants) {
    for (const mode of ["streamed", "loaded"] as const) {
      test(`${variant.name} [${mode}]`, () => run(variant, mode));
    }
  }
});
