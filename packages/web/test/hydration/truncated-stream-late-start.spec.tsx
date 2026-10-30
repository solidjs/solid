/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Truncation (#2958) when the runtime boots after the parser finished: an
 * entry that waits on a route module, or a deferred one, runs hydrate() once
 * `readyState` has left "loading", so there is no DOMContentLoaded left to
 * wait for. Under the in-render bootstrap (`_$HY.s`) every declaration and
 * every settle is a parser-inserted script, so a `_fr` still unsettled at
 * that point was cut off and has to release its boundary the same way.
 * Separate file because the ledger's truncation record is module state.
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

test("a runtime that boots after the parser finished releases a truncated boundary", async () => {
  const { shell } = JSON.parse(
    readFileSync(resolve(artifactsDir, `${scenario.name}.json`), "utf-8")
  ) as { shell: string; rest: string };
  const key = shell.match(/_\$HY\.r\["([^"]+)_fr"\]/)![1];
  const container = document.createElement("div");
  document.body.appendChild(container);
  // The in-render bootstrap declares the shell-end ledger, and the shell's
  // marker has run: the whole shell parsed, then the connection dropped.
  (globalThis as any)._$HY = {
    events: [],
    completed: new WeakSet(),
    r: {},
    s: { "": 1 },
    fe() {}
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // Parsing is over before the entry runs: DOMContentLoaded is behind us
  // (or about to fire with nothing left to deliver).
  Object.defineProperty(document, "readyState", { value: "interactive", configurable: true });

  container.innerHTML = shell.replace(scriptRe, "");
  for (const m of shell.matchAll(scriptRe)) (0, eval)(m[1]);
  const hy = (globalThis as any)._$HY;
  // The shell's own pending data ref (the boundary's async memo), which the
  // cut drops from the registry before the fragment pass.
  const pendingData = Object.keys(hy.r).filter(
    k => !k.endsWith("_fr") && typeof hy.r[k]?.then === "function" && !hy.r[k].s
  );
  expect(pendingData.length).toBeGreaterThan(0);
  expect(hy.r[`${key}_fr`].s).toBeFalsy();

  const dispose = hydrate(() => <scenario.App />, container);
  flush();

  // Both passes ran at boot: the fragment is rejected and the dead data
  // refs are already out of the registry.
  const ref = hy.r[`${key}_fr`];
  expect(ref.s).toBe(2);
  expect(String(ref.v)).toContain("truncated");
  for (const k of pendingData) expect(k in hy.r).toBe(false);

  await sleep(20);
  flush();
  await sleep(20);
  flush();

  // The boundary released through the rejection path, hydration finished,
  // and the dead data refs stayed out of the registry so later reads compute
  // fresh.
  expect(hy.done).toBe(true);
  for (const k of pendingData) expect(k in hy.r).toBe(false);

  warn.mockRestore();
  dispose();
  container.remove();
  delete (document as any).readyState;
});
