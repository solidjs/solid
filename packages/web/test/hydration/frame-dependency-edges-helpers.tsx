/**
 * @jsxImportSource @solidjs/web
 *
 * Shared by the frame-dependency-edges*.spec.tsx hydrate specs: boots the
 * document test/server/frame-dependency-edges.spec.tsx rendered and
 * hydrates it under deferred hydration. One page per spec file: the frames
 * client's boundary index and claim set are module state.
 *
 * Writes are made synchronously after the boot: the idle pass waits for a
 * timer, so every occurrence is still unmounted when they land.
 */
import { afterAll, beforeAll, vi } from "vitest";
import { hydrate } from "@solidjs/web";
import { installServerComponents, setDeferredHydration } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { makeHost } from "../lifecycle-matrix/harness.js";
import { ARGS, FID, makeApp, mounted } from "../harness/frame-dependency-edges.jsx";
import { applyChunk, loadArtifact } from "./frame-live-document-helpers.js";

export const ALL = [
  "cart",
  "derived",
  "item:a",
  "item:b",
  "item:c",
  "item:d",
  "late",
  "store",
  "wide"
];

/** Turn deferred hydration on for the spec file (the suite runs eager). */
export function deferredHydration() {
  beforeAll(() => setDeferredHydration(true));
  afterAll(() => setDeferredHydration(false));
}

export function bootEdges(options: { drift?: boolean } = {}) {
  const { shell, rest } = loadArtifact("frame-dependency-edges");
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  installServerComponents(makeHost().host);
  vi.stubGlobal("fetch", async () => {
    throw new Error("unexpected fetch");
  });
  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  const list = createServerReference(FID);
  const App = makeApp(() => list(...ARGS), options);
  applyChunk(container, shell + rest, true);
  mounted.length = 0;
  const dispose = hydrate(() => <App />, container);
  const text = (id: string) => container.querySelector(`#${id}`)!.textContent;
  /** Mounted occurrences, sorted. */
  const seen = () => [...mounted].sort();
  return {
    container,
    warnings,
    text,
    seen,
    dispose: () => {
      dispose();
      container.remove();
    }
  };
}
