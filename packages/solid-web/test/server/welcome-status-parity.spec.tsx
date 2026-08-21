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
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import {
  frameTransformDirectResult,
  ServerComponentPlugin
} from "@dom-expressions/runtime/src/frame-sink.js";
import { FID, makeWelcome, statusFill } from "../harness/frames-welcome.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

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

describe("welcome/status parity — server render (document face)", () => {
  // One artifact per hydration replay mode (see the FID note in the harness).
  for (const mode of ["loaded", "streamed"] as const) {
    test(`renders the settled fill and writes the ${mode}-mode artifact`, async () => {
      const Inline = frameTransformDirectResult(makeWelcome(), { id: FID(mode) }) as any;
      const { shell, rest } = await collectChunks(() => Inline({ status: statusFill }));
      const full = shell + rest;

      // The bounded generation settles before the response closes: the final
      // markup carries the settled branches the client must claim.
      const visible = full.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");
      expect(visible).toContain("42 tokens");
      expect(visible).toContain("7 tok/s");

      writeFileSync(
        resolve(artifactsDir, `welcome-status-${mode}.json`),
        JSON.stringify({ name: `welcome-status-${mode}`, shell, rest }, null, 2)
      );
    });
  }
});
