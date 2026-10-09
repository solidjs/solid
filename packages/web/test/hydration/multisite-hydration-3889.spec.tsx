/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3889: hydrating two mounts of one shared server-component factory must
 * keep both client counters. The server renders two buttons; hydration used
 * to adopt the first frame and drop the second.
 *
 * One page per file: the frames client's boundary index is module state.
 */
import { expect, test, vi } from "vitest";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { makeHost } from "../lifecycle-matrix/harness.js";
import { applyChunk, drain } from "./frame-live-document-helpers.js";
import { ARTIFACT, FID, makeApp } from "../harness/multisite-hydration-3889.jsx";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

function loadArtifact(): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${ARTIFACT}.json`);
  if (!existsSync(file))
    throw new Error(
      `Missing artifact "${ARTIFACT}" — run the server spec first: ` +
        `vitest run --config vite.config.server.mjs test/server/multisite-hydration-3889.spec.tsx`
    );
  return JSON.parse(readFileSync(file, "utf-8"));
}

test("two mounts of one server-component factory keep independent counters (#3889)", async () => {
  const { shell, rest } = loadArtifact();
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { host } = makeHost();
  installServerComponents(host);

  vi.stubGlobal("fetch", async () => {
    throw new Error("unexpected fetch");
  });
  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });

  const note = createServerReference(FID);
  const App = makeApp(() => note());

  applyChunk(container, shell, true);
  if (rest) applyChunk(container, rest, false);

  const before = [...container.querySelectorAll("button")];
  expect(before.length, "server rendered two counters").toBe(2);

  const dispose = hydrate(() => <App />, container);
  flush();
  await drain();

  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.length, `${container.innerHTML}\n${warnings.join("\n")}`).toBe(2);
  expect(buttons[0], "first counter claimed in place").toBe(before[0]);
  expect(buttons[1], "second counter claimed in place").toBe(before[1]);
  expect(buttons.map(b => b.textContent)).toEqual(["0", "0"]);
  expect(warnings.filter(w => /hydration|unclaimed|key miss/i.test(w))).toEqual([]);
  expect(errors).toEqual([]);

  (buttons[1] as HTMLButtonElement).click();
  flush();
  await drain();
  const afterSecond = [...container.querySelectorAll("button")];
  expect(afterSecond.length).toBe(2);
  expect(afterSecond.map(b => b.textContent)).toEqual(["0", "1"]);

  (afterSecond[0] as HTMLButtonElement).click();
  flush();
  await drain();
  const afterFirst = [...container.querySelectorAll("button")];
  expect(afterFirst.length).toBe(2);
  expect(afterFirst.map(b => b.textContent)).toEqual(["1", "1"]);
  expect(afterFirst[0].isConnected).toBe(true);
  expect(afterFirst[1].isConnected).toBe(true);

  dispose();
  container.remove();
});
