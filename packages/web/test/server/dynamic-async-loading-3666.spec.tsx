/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the #3666 pair (see test/harness/dynamic-async-loading-3666
 * .tsx). Renders each variant with renderToStream, pins the wire shape, and
 * writes the artifacts test/hydration/dynamic-async-loading-3666.spec.tsx
 * replays into jsdom.
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { variants } from "../harness/dynamic-async-loading-3666.jsx";

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

describe("async dynamic() inside Loading (#3666) — server render", () => {
  for (const variant of variants) {
    test(`${variant.name}: writes the artifact`, async () => {
      const { shell, rest } = await collectChunks(() => <variant.App />);
      console.log(`${variant.name} SHELL:\n${shell}\n\nREST:\n${rest}`);

      if (variant.streams) {
        expect(visibleText(shell)).toContain("Loading…");
        expect(rest).toContain("<article");
      } else {
        expect(visibleText(shell)).not.toContain("Loading…");
        expect(shell).toContain("<article");
        expect(rest).toBe("");
      }

      writeFileSync(
        resolve(artifactsDir, `${variant.name}.json`),
        JSON.stringify({ name: variant.name, shell, rest }, null, 2)
      );
    });
  }
});
