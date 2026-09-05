/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Unified For under HYDRATION (H2 v1) — replays the server artifacts from
 * test/harness/for-slot-scenarios.tsx and asserts what the generic parity
 * harness cannot: that the slot actually ENGAGED, that hydrated rows are
 * the server's own nodes, that structural updates then run through the
 * slot (moved, not recreated), that mismatches reconcile at the fill, and
 * that a demote mid-fill hands claims back cleanly.
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush, DEV } from "solid-js";
const stats = DEV!.unifiedFor;
import { hydrate } from "@solidjs/web";
import { forSlotScenarios, type ForSlotScenario } from "../harness/for-slot-scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

function applyChunk(container: HTMLDivElement, chunk: string) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  container.innerHTML = chunk.replace(scriptRe, "");
  for (const s of scripts) (0, eval)(s);
}

async function run(scenario: ForSlotScenario) {
  const { shell, rest } = loadArtifact(scenario.name);
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell + rest);
    // Server nodes BEFORE hydration, by initial text — identity oracle.
    const serverRows = scenario.identitySelector
      ? new Map(
          [...container.querySelectorAll(scenario.identitySelector)].map(el => [el.textContent, el])
        )
      : null;

    const engaged0 = stats.engaged;
    const demoted0 = stats.demoted;
    dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();

    expect(container.textContent, "hydrated text").toBe(scenario.expectedText);
    expect(stats.engaged - engaged0, "slots engaged during hydrate").toBe(scenario.engaged);
    expect(stats.demoted - demoted0, "slots demoted during hydrate").toBe(scenario.demoted);
    expect(warn, "console.warn calls during hydrate").toHaveBeenCalledTimes(scenario.warnings);

    if (serverRows) {
      // Every row present after hydration whose text existed on the server
      // must BE the server node (claimed, not recreated).
      for (const el of container.querySelectorAll(scenario.identitySelector!)) {
        const server = serverRows.get(el.textContent);
        if (server) expect(el, `row "${el.textContent}" is the server node`).toBe(server);
      }
    }

    if (scenario.update) {
      const before = scenario.identitySelector
        ? new Map(
            [...container.querySelectorAll(scenario.identitySelector)].map(el => [
              el.textContent,
              el
            ])
          )
        : null;
      scenario.update();
      flush();
      expect(container.textContent, "text after update").toBe(scenario.expectedTextAfterUpdate);
      if (scenario.survivorsAfterUpdate && before) {
        for (const text of scenario.survivorsAfterUpdate) {
          const now = [...container.querySelectorAll(scenario.identitySelector!)].find(
            el => el.textContent === text
          );
          expect(now, `survivor "${text}" present`).toBeDefined();
          expect(now, `survivor "${text}" moved, not recreated`).toBe(before.get(text));
        }
      }
      // No demote may happen on the post-hydration update either.
      expect(stats.demoted - demoted0).toBe(scenario.demoted);
    }
  } finally {
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

describe("unified For — hydration (slot engages, claims server rows)", () => {
  for (const scenario of forSlotScenarios) {
    test(scenario.name, async () => {
      await run(scenario);
    });
  }
});
