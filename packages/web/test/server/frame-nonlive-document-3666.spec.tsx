/**
 * @jsxImportSource @solidjs/web
 */
// #3666 follow-up — server half. `dynamic(() => note("a"))` over the
// in-process answer of a NON-LIVE server component: a promise of the
// component wrapped by `frameTransformDirectResult`. Writes the chunk
// artifacts test/hydration/frame-nonlive-document-3666.spec.tsx replays.
import { describe, expect, test } from "vitest";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import {
  ARGS,
  VARIANTS,
  fidFor,
  makeApp,
  makeNoteComponent
} from "../harness/frame-nonlive-document-3666.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const collectChunks = (code: () => any) =>
  recordStream(code, { plugins: [ServerComponentPlugin] } as any);

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

describe("document face — NON-LIVE server component under Loading (#3666) — server render", () => {
  for (const variant of VARIANTS) {
    for (const mode of variant === "streamed" ? ["loaded", "streamed"] : ["loaded"]) {
      const FID = fidFor(variant, mode);
      test(`${variant} [${mode}]: writes the artifact`, async () => {
        const Inline = frameTransformDirectResult(makeNoteComponent("note v1"), {
          id: FID,
          args: ARGS
        }) as any;
        const App = makeApp(
          variant === "inline"
            ? () => Promise.resolve(Inline)
            : async () => {
                await sleep(5);
                return Inline;
              }
        );

        const { shell, rest } = await collectChunks(() => <App />);
        const full = shell + rest;
        console.log(`${FID} SHELL:\n${shell}\n\nREST:\n${rest}`);

        expect(visibleText(full)).toContain("note v1");
        expect(full).toContain(`data-fid="${FID}"`);
        if (variant === "inline") {
          expect(visibleText(shell)).not.toContain("shell-fallback");
          expect(rest).toBe("");
        } else {
          expect(visibleText(shell)).toContain("shell-fallback");
          expect(rest).toContain(`data-fid="${FID}"`);
        }

        writeArtifact(`frame-nonlive-document-3666-${variant}-${mode}`, {
          name: `frame-nonlive-document-3666-${variant}-${mode}`,
          shell,
          rest
        });
      });
    }
  }
});
