/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Truncation (#2958) after the content template parsed but before the scripts
 * that settle and swap it ran: the boundary must still release. Separate file
 * because the ledger's truncation record is module state.
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
const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;

test("a content template that parsed before the cut still releases the boundary", async () => {
  const { shell, rest } = JSON.parse(
    readFileSync(resolve(artifactsDir, `${scenario.name}.json`), "utf-8")
  ) as { shell: string; rest: string };
  const key = shell.match(/_\$HY\.r\["([^"]+)_fr"\]/)![1];
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });

  container.innerHTML = shell.replace(scriptRe, "");
  for (const m of shell.matchAll(scriptRe)) (0, eval)(m[1]);
  const dispose = hydrate(() => <scenario.App />, container);
  flush();
  await sleep(10);
  flush();

  container.insertAdjacentHTML("beforeend", rest.replace(scriptRe, ""));
  expect(document.getElementById(key)).not.toBeNull();
  expect(document.getElementById(`pl-${key}`)).not.toBeNull();

  const hy = (globalThis as any)._$HY;
  Object.defineProperty(document, "readyState", { value: "interactive", configurable: true });
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await sleep(20);
  flush();
  await sleep(20);
  flush();

  expect(hy.r[`${key}_fr`].s).toBe(2);
  expect(hy.done).toBe(true);

  warn.mockRestore();
  dispose();
  container.remove();
  delete (document as any).readyState;
});
