/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Regression for #2964: a streamed fragment that settles AFTER global
 * hydration completes must remain claimable by the boundary waiting on it.
 *
 * In a single classic hydrate pass this ordering cannot arise — a Loading
 * that renders during the sync pass registers pending and holds hydration
 * open until its fragment settles. It arises when the boundary renders in a
 * DEFERRED claim scope: a frames slot fill or a lazy route module mounts the
 * boundary after an earlier hydrate pass already completed. The stream's $df
 * used to discard late content once done. For plain client content the
 * boundary papers over the loss by re-rendering from data; for server
 * components the markup IS the content and the region settles permanently
 * blank.
 *
 * The reveal policy now lives in the hydration runtime (`_$HY.f`, installed
 * by enableHydration; the inline script keeps only the swap mechanics in
 * $dfr): swaps proceed while hydration is in progress or the fragment has a
 * claimant on record; unclaimed post-done arrivals are HELD — placeholder,
 * fallback, and template intact — and replayed the moment their boundary
 * shows up, before any of its paths read the DOM.
 *
 * The distinguishing observable is node provenance: the settled content must
 * be the CLAIMED server-rendered node (carries `_hk`); with a discard it
 * would be fresh client DOM.
 *
 * Replays the real server-rendered chunk artifact (late-boundary-after-done
 * in the parity harness) so the scripts under test are the actual emitted
 * ones.
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios } from "../harness/scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const scenario = scenarios.find(s => s.name === "late-boundary-after-done")!;

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

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  return scripts;
}

// The fragment's wire key (shared by `pl-<key>` markers, `$df("<key>")`, and
// the `<key>_fr` registry entry the client boundary registers against).
function fragmentKey(shell: string): string {
  return shell.match(/_\$HY\.r\["([^"]+)_fr"\]/)![1];
}

describe("late fragment after hydration completes (#2964)", () => {
  test("boundary registered first: the late swap proceeds and the boundary claims server content", async () => {
    const { shell, rest } = loadArtifact(scenario.name);
    const container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const s of applyChunk(container, shell, true)) (0, eval)(s);
    const dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();

    // The boundary registered against the pending `<key>_fr` and holds
    // hydration open; its claim is on record with the reveal policy. The
    // stand-in for the frames condition — an earlier pass latched the global
    // done flag — must not confuse the policy into holding a claimed swap.
    (globalThis as any)._$HY.done = true;

    for (const s of applyChunk(container, rest, false)) {
      (0, eval)(s);
      await Promise.resolve();
    }
    await sleep(50);
    flush();
    await sleep(50);
    flush();

    expect(container.textContent).toBe(scenario.expectedText);
    // The load-bearing assertion: the settled content is the server-rendered
    // node, claimed in place — not a fresh client re-render over a discarded
    // fragment. (Server nodes carry `_hk`; client-created ones never do.)
    const section = container.querySelector("section")!;
    expect(section.hasAttribute("_hk")).toBe(true);

    const orphanWarns = warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns).toHaveLength(0);
    warn.mockRestore();
    dispose();
    container.remove();
  });

  test("fragment arrived first: the swap is held intact and replayed when the boundary shows up", async () => {
    const { shell, rest } = loadArtifact(scenario.name);
    const key = fragmentKey(shell);
    const container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Shell lands (fallback showing, `<key>_fr` pending) but its boundary
    // does not render yet — it lives behind a deferred claim scope. An
    // unrelated hydrate pass completes, latching global hydration done.
    for (const s of applyChunk(container, shell, true)) (0, eval)(s);
    const other = document.createElement("div");
    document.body.appendChild(other);
    hydrate(() => null, other)();
    flush();
    await sleep(10);

    // The fragment now arrives — content template, $df, and the script that
    // RESOLVES the `_fr` ref, all in one chunk. Post-done with no claimant,
    // the policy holds the swap: fallback, placeholder, and template all
    // stay in place instead of being discarded.
    for (const s of applyChunk(container, rest, false)) {
      (0, eval)(s);
      await Promise.resolve();
    }
    expect(container.textContent).toBe("lead waiting tail");
    expect(container.querySelector(`template[id="pl-${key}"]`)).not.toBe(null);
    expect(container.querySelector(`template[id="${key}"]`)).not.toBe(null);

    // The deferred scope finally runs. The boundary sees a SETTLED `_fr`
    // ref — the path that assumes the swap already ran — so the held swap
    // must replay before it reads the DOM, and the boundary must claim the
    // server-rendered content in place. In production this scope is a frames
    // slot fill (claimRender), which engages the hydration machinery
    // directly and never passes hydrate()'s post-done degrade-to-render
    // guard — clear the latch so this hydrate() stands in for it.
    delete (globalThis as any)._$HY.done;
    const dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(50);
    flush();

    expect(container.textContent).toBe(scenario.expectedText);
    const section = container.querySelector("section")!;
    expect(section.hasAttribute("_hk")).toBe(true);
    expect(container.querySelector(`template[id="pl-${key}"]`)).toBe(null);

    const orphanWarns = warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns).toHaveLength(0);
    warn.mockRestore();
    dispose();
    container.remove();
    other.remove();
  });
});
