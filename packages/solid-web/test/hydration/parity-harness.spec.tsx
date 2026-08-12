/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Client half of the hydration parity harness (#2801).
 *
 * Replays the server-rendered chunk artifacts produced by
 * test/server/hydration-harness.spec.tsx (ssr generate) and hydrates the
 * identically-sourced component compiled with the dom generate
 * (test/harness/scenarios.tsx). Invariants asserted for every scenario:
 *
 *  1. No console.warn during hydration or updates — promotes
 *     `verifyHydration` unclaimed-node reports and claim tag mismatches from
 *     ignorable dev noise to test failures.
 *  2. No client-created DOM during hydration — the dev-mode `create()` guard
 *     in the runtime throws, failing the test.
 *  3. textContent matches once hydration settles.
 *  4. Node identity: every server-rendered `[_hk]` element is claimed and
 *     survives; post-update they must be the same objects (no re-creation).
 *  5. Post-hydration update pass — fires the scenario's signal and asserts
 *     the DOM. Insert bookkeeping drift (#2801 bug 1) is invisible at
 *     hydration time and only manifests on the first refresh; this catches
 *     that class.
 *
 * Scenarios with `knownFailure` document bugs on main via test.fails; flip
 * them as fixes land.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios, type Scenario } from "../harness/scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact for scenario "${name}". Run the server harness first: ` +
        `vitest run --config vite.config.server.mjs test/server/hydration-harness.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

// Split a chunk into markup and inline scripts, apply the markup, then eval
// the scripts — mirroring what a streaming browser parse does.
function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

async function settle() {
  await sleep(50);
  flush();
  await sleep(50);
  flush();
}

/**
 * mode "loaded": every chunk is applied before hydrate() — the full-page
 * refresh case; boundary state is settled when hydration starts.
 * mode "streamed": shell, hydrate, then late chunks — live streaming with
 * $df fragment swaps racing hydration.
 */
async function runScenario(scenario: Scenario, mode: "loaded" | "streamed") {
  const { shell, rest } = loadArtifact(scenario.name);
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let dispose: (() => void) | undefined;

  try {
    applyChunk(container, shell, true);
    if (mode === "loaded" && rest) applyChunk(container, rest, false);

    dispose = hydrate(() => <scenario.App />, container);
    flush();
    // hydration completes on a microtask; updates before that are no-ops
    await sleep(10);
    flush();

    if (mode === "streamed" && rest) {
      await sleep(30);
      flush();
      applyChunk(container, rest, false);
    }
    if (scenario.async) await settle();

    expect(container.textContent).toBe(
      (mode === "streamed" && scenario.expectedTextStreamed) || scenario.expectedText
    );

    if (scenario.update) {
      // Elements outside the updated hole must keep identity across the
      // update — recreation means insert's bookkeeping drifted (#2801 bug 1).
      const stable = scenario.stableSelector
        ? [...container.querySelectorAll(scenario.stableSelector)]
        : [];
      scenario.update();
      flush();
      if (scenario.async) await settle();
      expect(container.textContent).toBe(scenario.expectedTextAfterUpdate ?? scenario.expectedText);
      if (scenario.stableSelector) {
        const after = [...container.querySelectorAll(scenario.stableSelector)];
        expect(after.length).toBe(stable.length);
        for (let i = 0; i < stable.length; i++) {
          expect(after[i], `stable node <${stable[i].localName}> was replaced`).toBe(stable[i]);
        }
      }
    }

    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    dispose?.();
    // let queued hydration-event microtasks drain before tearing down _$HY
    await sleep(0);
    container.remove();
  }
}

function registerScenario(scenario: Scenario) {
  const modes: Array<"loaded" | "streamed"> = scenario.async ? ["loaded", "streamed"] : ["loaded"];
  for (const mode of modes) {
    const failure =
      scenario.knownFailure ?? (mode === "streamed" ? scenario.knownFailureStreamed : undefined);
    const testFn = failure ? test.fails : test;
    const title =
      (scenario.async ? `${scenario.name} [${mode}]` : scenario.name) +
      (failure ? ` (known failure: ${failure})` : "");
    testFn(title, () => runScenario(scenario, mode));
  }
}

describe("hydration parity harness — client hydrate", () => {
  beforeEach(async () => {
    // let any prior scenario's pending async work settle before the next
    await sleep(0);
  });
  afterEach(async () => {
    await sleep(0);
  });

  for (const scenario of scenarios) registerScenario(scenario);
});
