/**
 * @jsxImportSource @solidjs/web
 */
// #3666 follow-up — server half. `dynamic(() => note("a"))` over the
// in-process answer of a NON-LIVE server component: a promise of the
// component wrapped by `frameTransformDirectResult`. Writes the chunk
// artifacts test/hydration/frame-nonlive-document-3666.spec.tsx replays.
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import {
  ARGS,
  VARIANTS,
  fidFor,
  makeApp,
  makeNoteComponent
} from "../harness/frame-nonlive-document-3666.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function collectChunks(code: () => any): Promise<{ shell: string; rest: string }> {
  return new Promise(resolvePromise => {
    const chunks: string[] = [];
    let shell = "";
    let shellDone = false;
    renderToStream(code, {
      plugins: [ServerComponentPlugin],
      onCompleteShell() {
        shellDone = true;
      }
    } as any).pipe({
      write(chunk: string) {
        chunks.push(chunk);
        if (shellDone && !shell) shell = chunks.join("");
      },
      end() {
        const full = chunks.join("");
        if (!shell) shell = full;
        resolvePromise({ shell, rest: full.slice(shell.length) });
      }
    });
  });
}

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

        writeFileSync(
          resolve(artifactsDir, `frame-nonlive-document-3666-${variant}-${mode}.json`),
          JSON.stringify(
            { name: `frame-nonlive-document-3666-${variant}-${mode}`, shell, rest },
            null,
            2
          )
        );
      });
    }
  }
});
