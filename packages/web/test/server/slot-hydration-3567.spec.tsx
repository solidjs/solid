/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the #3567 pair (see test/harness/slot-hydration-3567.tsx).
 * Renders every scenario with renderToString and writes the markup artifact
 * test/hydration/slot-hydration-3567.spec.tsx hydrates against the
 * dom-generate compilation of the same fixture. Also records the `_hk` keys
 * the server minted, in document order, so a key permutation is legible in
 * the artifact diff.
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "@solidjs/web";
import { scenarios } from "../harness/slot-hydration-3567.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

describe("JSX through a non-children prop (#3567) — server render", () => {
  for (const scenario of scenarios) {
    test(`${scenario.name}: renders and writes the artifact`, () => {
      const html = renderToString(() => <scenario.App />);
      expect(visibleText(html)).toBe(scenario.expectedText);
      const keys = [...html.matchAll(/<(\w+) _hk=([\w-]+)/g)].map(m => `${m[1]}:${m[2]}`);
      writeFileSync(
        resolve(artifactsDir, `slot-hydration-3567-${scenario.name}.json`),
        JSON.stringify({ name: scenario.name, html, keys }, null, 2)
      );
    });
  }
});
