/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the #3666 pair (see test/harness/dynamic-async-loading-3666
 * .tsx). Renders each variant with renderToStream, pins the wire shape, and
 * writes the artifacts test/hydration/dynamic-async-loading-3666.spec.tsx
 * replays into jsdom.
 */
import { describe, expect, test } from "vitest";
import { variants } from "../harness/dynamic-async-loading-3666.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

describe("async dynamic() inside Loading (#3666) — server render", () => {
  for (const variant of variants) {
    test(`${variant.name}: writes the artifact`, async () => {
      const { shell, rest } = await recordStream(() => <variant.App />);
      console.log(`${variant.name} SHELL:\n${shell}\n\nREST:\n${rest}`);

      if (variant.streams) {
        expect(visibleText(shell)).toContain("Loading…");
        expect(rest).toContain("<article");
      } else {
        expect(visibleText(shell)).not.toContain("Loading…");
        expect(shell).toContain("<article");
        expect(rest).toBe("");
      }

      writeArtifact(variant.name, { name: variant.name, shell, rest });
    });
  }
});
