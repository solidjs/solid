/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the #3574 pair (see test/harness/hybrid-store-handoff-3574
 * .tsx). Renders each variant with renderToStream and writes the chunk
 * artifact test/hydration/hybrid-store-handoff-3574.spec.tsx replays into
 * jsdom against the dom-generate compilation of the same fixture. Also pins
 * the wire shape the issue depends on: the boundary suspends into the shell
 * and the answer's resolver runs before the fragment swap in the late chunk.
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { variants } from "../harness/hybrid-store-handoff-3574.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

function collectChunks(code: () => any): Promise<{ shell: string; rest: string }> {
  return new Promise(resolvePromise => {
    const chunks: string[] = [];
    let shell = "";
    let shellDone = false;
    renderToStream(code, {
      onCompleteShell() {
        shellDone = true;
      }
    }).pipe({
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

describe("hybrid store under a streamed Loading (#3574) — server render", () => {
  for (const variant of variants) {
    test(`${variant.name}: suspends into the shell, streams the answer, writes the artifact`, async () => {
      const { shell, rest } = await collectChunks(() => <variant.App />);

      // The store has no loading window, so the boundary flushes its
      // fallback into the shell and the content arrives as a fragment.
      expect(visibleText(shell)).toBe("loading");
      expect(rest).not.toBe("");
      expect(visibleText(rest)).toBe("true:0");

      // The late chunk's script order is the trigger: the store's answer
      // resolves before the fragment is revealed, so the client's handoff
      // can start before the boundary resumes.
      const swap = rest.indexOf("$df(");
      expect(swap).toBeGreaterThan(-1);
      expect(rest.slice(0, swap)).toContain("ready");

      writeFileSync(
        resolve(artifactsDir, `${variant.name}.json`),
        JSON.stringify({ name: variant.name, shell, rest }, null, 2)
      );
    });
  }
});
