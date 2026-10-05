/**
 * @jsxImportSource @solidjs/web
 *
 * Client half of the document-face slot-fill hydration parity pair (the chat
 * example's `welcome`/`Status` shape — see test/harness/frames-welcome.tsx).
 * Shared by welcome-status-loaded.spec.tsx / welcome-status-streamed.spec.tsx:
 * ONE MODE PER SPEC FILE, because solid's hydration module installs its
 * document hooks (`_$HY.f`, the fragment ledger publication) once per module
 * graph — replaying a second artifact after deleting `_$HY` in the same
 * worker leaves the fresh object hookless, which no real page ever is.
 *
 * Replays the server-rendered chunk artifact produced by
 * test/server/welcome-status-parity.spec.tsx and hydrates the
 * identically-sourced fill against the adopted boundary. The fill claims
 * under the producer's occurrence keys (`sc-<fid>-status#0-…`), so the claim
 * paths the client allocates must be byte-identical to what the ssr compile
 * minted — any extra reactive scope the client wraps an arg read in shows up
 * as a hydration key miss and a re-rendered (or blank) range.
 *
 * The `usage` arg is a container trace, and the frames client loads the
 * materializer LAZILY (`solid-js/internal/container-trace`, behind the first
 * record that carries a trace). Two configurations, one per spec file:
 *   - resident (default): the materializer is installed before `hydrate()`,
 *     as the production host has it once that load has settled — the claim
 *     walk revives synchronously and the fill claims in the root pass;
 *   - `lazy`: the production host wiring with nothing installed — the frame
 *     HOLDS the `status#0` occurrence (server interior on screen) while the
 *     materializer loads, then mounts the fill, which claims the same nodes
 *     in place. Same assertions: the attach is late, never a re-render.
 */
import { expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { materializeContainerTrace } from "solid-js/internal/container-trace";
import { hydrate } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../../frames/src/client.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";
import {
  reviveContainerTraces,
  isMaterializedContainer,
  setContainerTraceMaterializer
} from "../../frames/src/frame-container-plugin.js";
import { FID, statusFill } from "../harness/frames-welcome.jsx";

const traceState = () => (globalThis as any)[Symbol.for("solid.container-trace-state")];

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadArtifact(mode: "loaded" | "streamed"): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `welcome-status-${mode}.json`);
  if (!existsSync(file)) {
    throw new Error(
      "Missing artifact. Run the server harness first: " +
        "vitest run --config vite.config.server.mjs test/server/welcome-status-parity.spec.tsx"
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

// Split a chunk into markup and inline scripts, apply the markup, then eval
// the scripts — mirroring what a streaming browser parse does.
function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r),
    // The production host (getFrameHost) wires these; the document-face
    // container-trace args under test need the same revival at arg-read.
    revive: reviveContainerTraces,
    isContainer: isMaterializedContainer
  });
}

async function settle() {
  await sleep(30);
  flush();
  await sleep(30);
  flush();
}

export function cleanupWelcomeStatusParity() {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as any)._$HY;
  delete (globalThis as any)._$SC;
  delete (globalThis as any).$R;
  document.body.innerHTML = "";
}

export async function runWelcomeStatusParity(
  mode: "loaded" | "streamed",
  options: { lazy?: boolean } = {}
) {
  const { shell, rest } = loadArtifact(mode);
  const fid = FID(mode);
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  vi.stubGlobal("fetch", () => {
    throw new Error("fetch must not be called");
  });
  if (options.lazy) {
    expect(traceState()?.materializeTrace).toBeUndefined();
    installServerComponents();
  } else {
    setContainerTraceMaterializer(materializeContainerTrace);
    installServerComponents(makeHost());
  }

  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: any[]) => {
    warnings.push(args.map(String).join(" "));
  });

  applyChunk(container, shell, true);
  if (mode === "loaded") applyChunk(container, rest, false);

  const frame = container.querySelector(`solid-frame[data-fid="${fid}"]`)!;
  const ssrStatus = container.querySelector(".status");
  expect(ssrStatus).toBeTruthy();
  const ssrText = frame.textContent;

  const SC = (globalThis as any)._$SC.r(fid);
  const dispose = hydrate(() => <SC status={statusFill} />, container);
  flush();
  await Promise.resolve();
  flush();

  if (options.lazy) {
    // The hold: the root pass adopted the boundary with the materializer
    // absent, so `status#0` is not mounted yet and the server-rendered
    // interior stands untouched — exactly what was on screen.
    expect(frame.textContent).toBe(ssrText);
    // The load (a dynamic import through the frames client) settles on its
    // own schedule; wait for the install, then for the re-sync it triggers.
    for (let i = 0; i < 200 && !traceState()?.materializeTrace; i++) await sleep(10);
    expect(traceState()?.materializeTrace).toBeTypeOf("function");
  }

  if (mode === "streamed") applyChunk(container, rest, false);
  await settle();

  if (process.env.DEBUG_DOM)
    process.stdout.write(
      "[final] " +
        JSON.stringify(frame.textContent) +
        " :: " +
        container.innerHTML.replace(/<script[\s\S]*?<\/script>/g, "[S]") +
        "\n"
    );
  // The settled branches land either way: meter counted up, stats
  // replaced the ticker, and no hydration warnings fired.
  expect(frame.textContent).toContain("42 tokens");
  expect(warnings).toEqual([]);
  // Claim, not re-render: the server-rendered wrapper is still THE node.
  expect(container.querySelector(".status")).toBe(ssrStatus);

  dispose();
  container.remove();
}
