/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the document-face slot-fill hydration parity pair (the chat
 * example's `welcome`/`Status` shape — see test/harness/frames-welcome.tsx).
 * Renders the server component inline at t=0 through the frame sink and
 * writes the chunk artifact test/hydration/welcome-status-parity.spec.tsx
 * replays into jsdom against the dom-generate compilation of the same fill.
 */
import { describe, expect, test } from "vitest";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import { FID, makeWelcome, statusFill } from "../harness/frames-welcome.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

describe("welcome/status parity — server render (document face)", () => {
  // One artifact per hydration replay mode (see the FID note in the harness).
  for (const mode of ["loaded", "streamed"] as const) {
    test(`renders the settled fill and writes the ${mode}-mode artifact`, async () => {
      const { shell, rest } = await recordStream(
        () => {
          // Inside the recorded render, on its clock: `makeWelcome()` starts
          // the generation's 15 ms `stats` timer at construction.
          const Inline = frameTransformDirectResult(makeWelcome(), { id: FID(mode) }) as any;
          return Inline({ status: statusFill });
        },
        { plugins: [ServerComponentPlugin] } as any
      );
      const full = shell + rest;

      // The bounded generation settles before the response closes: the final
      // markup carries the settled branches the client must claim.
      const visible = full.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");
      expect(visible).toContain("42 tokens");
      expect(visible).toContain("7 tok/s");
      // The generation's 5 ms events (the usage trace's last event, the
      // progress yield that settles the slot) land before its 15 ms `stats`
      // promise, in the fixture's order, on every host.
      const usageDone = rest.indexOf('"done"');
      const slot = rest.indexOf('type:"slot"');
      const stats = rest.indexOf("tokens:42");
      expect(usageDone).toBeGreaterThan(-1);
      expect(slot).toBeGreaterThan(usageDone);
      expect(stats).toBeGreaterThan(slot);

      writeArtifact(`welcome-status-${mode}`, { name: `welcome-status-${mode}`, shell, rest });
    });
  }
});
