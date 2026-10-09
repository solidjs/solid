/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3932: hydrating three calls of one server function, each with different
 * arguments, must adopt every block. The server rendered all three; the
 * later calls must not go back to the network.
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
import { ARTIFACT, FID, makeApp, TEXTS } from "../harness/multicall-hydration-3932.jsx";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

function loadArtifact(): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${ARTIFACT}.json`);
  if (!existsSync(file))
    throw new Error(
      `Missing artifact "${ARTIFACT}" — run the server spec first: ` +
        `vitest run --config vite.config.server.mjs test/server/multicall-hydration-3932.spec.tsx`
    );
  return JSON.parse(readFileSync(file, "utf-8"));
}

test("three calls with different arguments adopt in place and do not refetch (#3932)", async () => {
  const { shell, rest } = loadArtifact();
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { host } = makeHost();
  installServerComponents(host);

  const urls: string[] = [];
  vi.stubGlobal("fetch", async (input: any) => {
    urls.push(typeof input === "string" ? input : input.url);
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

  const render = createServerReference(FID);
  const App = makeApp((text: string) => render(text));

  applyChunk(container, shell, true);
  if (rest) applyChunk(container, rest, false);

  const before = [...container.querySelectorAll("p.block")];
  expect(before.map(el => el.textContent)).toEqual([...TEXTS]);

  const dispose = hydrate(() => <App />, container);
  flush();
  await drain();

  const blocks = [...container.querySelectorAll("p.block")];
  expect(blocks.length, `${container.innerHTML}\n${warnings.join("\n")}\n${urls.join("\n")}`).toBe(
    3
  );
  expect(blocks.map(el => el.textContent)).toEqual([...TEXTS]);
  expect(blocks[0], "first block claimed in place").toBe(before[0]);
  expect(blocks[1], "second block claimed in place").toBe(before[1]);
  expect(blocks[2], "third block claimed in place").toBe(before[2]);
  expect(urls, "later calls must not refetch").toEqual([]);
  expect(warnings.filter(w => /hydration|unclaimed|key miss/i.test(w))).toEqual([]);
  expect(errors).toEqual([]);

  dispose();
  container.remove();
});
