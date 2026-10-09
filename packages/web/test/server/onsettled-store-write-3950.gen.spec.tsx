/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/onsettled-store-write-3950.spec.tsx: renders
 * each variant and writes its shell plus the boundary's chunk.
 */
import { describe, expect, test } from "vitest";
import { variants } from "../harness/onsettled-store-write-3950.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

describe("store write from onSettled under a streamed Loading (#3950) — server render", () => {
  for (const variant of variants) {
    test(`${variant.name}: suspends into the shell, streams both rows`, async () => {
      const { shell, chunks } = await recordStream(() => <variant.App />);
      expect(visibleText(shell)).toBe("pending");
      expect(chunks).toHaveLength(1);
      expect(visibleText(chunks[0])).toBe("removekeep");
      writeArtifact(variant.name, { shell, chunks });
    });
  }
});
