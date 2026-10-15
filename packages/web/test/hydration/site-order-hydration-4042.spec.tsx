/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4042: the server minted the preview's site id after the docs site's
 * (async setup), but the client mounts the preview first. Each site must
 * adopt its own element without a request, and an update to the preview
 * must land in the preview's frame, not the docs one.
 *
 * One page per file: the frames client's boundary index is module state.
 */
import { expect, test, vi } from "vitest";
import { enableHydration, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { makeHost } from "../lifecycle-matrix/harness.js";
import { heldStream } from "../consistency/support.js";
import { applyChunk, drain } from "./frame-live-document-helpers.js";
import { ARTIFACT, FID, makeApp } from "../harness/site-order-hydration-4042.jsx";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

function loadArtifact(): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${ARTIFACT}.json`);
  if (!existsSync(file))
    throw new Error(
      `Missing artifact "${ARTIFACT}" — run the server spec first: ` +
        `vitest run --config vite.config.server.mjs test/server/site-order-hydration-4042.spec.tsx`
    );
  return JSON.parse(readFileSync(file, "utf-8"));
}

test("sites minted out of mount order each adopt their own element (#4042)", async () => {
  const { shell, rest } = loadArtifact();
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  enableHydration();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { host } = makeHost();
  installServerComponents(host);

  const wire = heldStream(FID);
  const calls: unknown[] = [];
  vi.stubGlobal("fetch", async (_input: any, init: any) => {
    calls.push(String(init?.body));
    return wire.response;
  });
  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });

  const render = createServerReference(FID);
  let setPreview!: (text: string) => void;
  const App = makeApp(
    (text: string) => render(text),
    set => (setPreview = set)
  );

  applyChunk(container, shell, true);
  if (rest) applyChunk(container, rest, false);
  const previewFrame = container.querySelector("#preview solid-frame")!;
  const docsFrame = container.querySelector("#docs solid-frame")!;
  expect(previewFrame.textContent).toBe("preview original");
  expect(docsFrame.textContent).toBe("documentation");

  const dispose = hydrate(() => <App />, container);
  flush();
  await drain();
  expect(calls, "hydration must not fetch").toEqual([]);
  expect(warnings.filter(w => /hydration|unclaimed|key miss/i.test(w))).toEqual([]);

  setPreview("preview updated");
  flush();
  await drain();
  expect(calls.length, String(calls)).toBe(1);
  expect(calls[0]).toContain("preview updated");
  wire.send({ type: "start", id: FID, version: 1 });
  wire.send({ type: "html", id: FID, version: 1, html: '<p class="block">preview updated</p>' });
  wire.send({ type: "complete", id: FID, version: 1 });
  wire.close();
  await drain();
  await drain();

  expect(container.querySelector("#docs solid-frame")!.textContent).toBe("documentation");
  expect(container.querySelector("#preview solid-frame")!.textContent).toBe("preview updated");

  dispose();
  container.remove();
});
