/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4074: the server writes a streamed fragment's reveal (`$df`) and the
 * script that settles its `<id>_fr` record as two scripts. An async entry
 * can start hydrating between them: the fragment is already swapped in
 * (`_$HY.v[id]`) while `_fr` still reads pending. The boundary must not
 * hydrate its fallback, which the reveal already removed (a "Hydration key
 * miss" and a detached element); it adopts the revealed content once `_fr`
 * settles.
 *
 * Replays the real server-rendered chunks of the late-boundary-after-done
 * harness scenario, split between the reveal and the settlement.
 */
import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios } from "../harness/scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const scenario = scenarios.find(s => s.name === "late-boundary-after-done")!;

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  return scripts;
}

test("#4074: a fragment revealed before its _fr settles hydrates the revealed content", async () => {
  const { shell, rest } = JSON.parse(
    readFileSync(resolve(artifactsDir, `${scenario.name}.json`), "utf-8")
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  for (const s of applyChunk(container, shell, true)) (0, eval)(s);
  const scripts = applyChunk(container, rest, false);
  // The reveal lands; the `_fr` settlement (the last script) has not.
  for (const s of scripts.slice(0, -1)) (0, eval)(s);
  expect(container.querySelector("p")).toBeNull();

  const dispose = hydrate(() => <scenario.App />, container);
  flush();
  await sleep(10);
  (0, eval)(scripts[scripts.length - 1]);
  await sleep(50);
  flush();
  await sleep(10);
  flush();

  expect(container.textContent).toBe(scenario.expectedText);
  // Claimed in place: the server node, not a client re-render.
  expect(container.querySelector("section")!.hasAttribute("_hk")).toBe(true);
  const misses = warn.mock.calls.filter(
    (c: unknown[]) => typeof c[0] === "string" && c[0].includes("Hydration key miss")
  );
  expect(misses).toEqual([]);
  warn.mockRestore();
  dispose();
  container.remove();
});
