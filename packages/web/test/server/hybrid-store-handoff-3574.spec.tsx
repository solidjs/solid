/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the #3574 pair (see test/harness/hybrid-store-handoff-3574
 * .tsx). Renders each variant with renderToStream and writes the chunk
 * artifact test/hydration/hybrid-store-handoff-3574.spec.tsx replays into
 * jsdom against the dom-generate compilation of the same fixture. Also pins
 * the wire shape the issue depends on: the boundary suspends into the shell
 * and the late chunk carries the fragment swap AND the answer's resolver in
 * one script — swap first, so the browser paints the content without parsing
 * the records behind it; the resolver then settles `_fr`, and the boundary's
 * resume runs as a microtask after the whole script, with the answer in hand.
 */
import { describe, expect, test } from "vitest";
import { variants } from "../harness/hybrid-store-handoff-3574.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

describe("hybrid store under a streamed Loading (#3574) — server render", () => {
  for (const variant of variants) {
    test(`${variant.name}: suspends into the shell, streams the answer, writes the artifact`, async () => {
      const { shell, rest } = await recordStream(() => <variant.App />);

      // The store has no loading window, so the boundary flushes its
      // fallback into the shell and the content arrives as a fragment.
      expect(visibleText(shell)).toBe("loading");
      expect(rest).not.toBe("");
      expect(visibleText(rest)).toBe("true:0");

      // The late chunk's script order is the trigger: the swap runs first
      // (reveals lead data in every flush) and the store's answer resolves
      // in the same script, so the client's handoff has the answer before
      // the boundary's resume — a microtask after the script — runs.
      const swap = rest.indexOf("$df(");
      expect(swap).toBeGreaterThan(-1);
      expect(rest.slice(0, swap)).not.toContain("ready");
      expect(rest.slice(swap)).toContain("ready");
      expect(rest.indexOf("</script>", swap)).toBeGreaterThan(rest.indexOf("ready", swap));

      writeArtifact(variant.name, { name: variant.name, shell, rest });
    });
  }
});
