/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Regression for #2964: a streamed fragment that settles AFTER global
 * hydration completes must remain claimable by the boundary waiting on it.
 *
 * In a single classic hydrate pass this ordering cannot arise — a Loading
 * that renders during the sync pass registers pending and holds `_$HY.done`
 * open until its fragment settles. It arises when the boundary renders in a
 * DEFERRED claim scope: a frames slot fill or a lazy route module mounts the
 * boundary after an earlier hydrate pass already latched `_$HY.done`. $df
 * used to discard late content once done. For plain client content the
 * boundary papers over the loss by re-rendering from data; for server
 * components the markup IS the content and the region settles permanently
 * blank. The distinguishing observable here is node provenance: with the
 * claimant protocol (markFragmentClaim → `_$HY.fk`, held swaps in `_$HY.hq`
 * replayed on registration) the settled content is the CLAIMED
 * server-rendered node (carries `_hk`); with the discard it is fresh client
 * DOM.
 *
 * Replays the real server-rendered chunk artifact (late-boundary-after-done
 * in the parity harness) so the $df under test is the actual emitted script;
 * `_$HY.done` is latched by hand to stand in for the earlier completed pass.
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
  test("with a claimant on record, the late swap proceeds and the boundary claims server content", async () => {
    const { shell, rest } = loadArtifact(scenario.name);
    const key = fragmentKey(shell);
    const container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const s of applyChunk(container, shell, true)) (0, eval)(s);
    const dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();

    // The boundary rendered and went on record as the fragment's claimant.
    expect((globalThis as any)._$HY.fk).toEqual({ [key]: 1 });

    // Stand-in for the frames condition: an earlier hydrate pass latched
    // done while this boundary still waits on its fragment.
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
    // The claimant mark was retired when the boundary resumed.
    expect((globalThis as any)._$HY.fk[key]).toBeUndefined();

    const orphanWarns = warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns).toHaveLength(0);
    warn.mockRestore();
    dispose();
    container.remove();
  });

  test("a swap held before the claimant registered is replayed at registration", async () => {
    const { shell } = loadArtifact(scenario.name);
    const key = fragmentKey(shell);
    const container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };

    // The fragment arrived post-done before this boundary existed: $df held
    // it (placeholder and template intact) and queued the id.
    (globalThis as any)._$HY.hq = { [key]: 1 };
    const replay = vi.fn();
    (globalThis as any).$df = replay;

    for (const s of applyChunk(container, shell, true)) (0, eval)(s);
    const dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();

    // Registration marked the claim, consumed the hold, and replayed the
    // swap so the content is in the DOM before this boundary's resume.
    expect((globalThis as any)._$HY.fk).toEqual({ [key]: 1 });
    expect((globalThis as any)._$HY.hq[key]).toBeUndefined();
    expect(replay).toHaveBeenCalledWith(key);

    dispose();
    container.remove();
    delete (globalThis as any).$df;
  });
});
