/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/write-before-resume.spec.tsx: renders the
 * page and writes its shell plus each later chunk.
 */
import { expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { createSharedApp } from "../harness/write-before-resume.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

test("render write-before-resume chunks", async () => {
  const { App } = createSharedApp();
  const out = await new Promise<{ shell: string; chunks: string[] }>(done => {
    const chunks: string[] = [];
    let shell: string | undefined;
    let shellDone = false;
    renderToStream(() => <App />, {
      onCompleteShell() {
        shellDone = true;
      }
    }).pipe({
      write(c: string) {
        chunks.push(c);
        if (shellDone && shell === undefined) shell = chunks.splice(0).join("");
      },
      end() {
        if (shell === undefined) shell = chunks.splice(0).join("");
        done({ shell, chunks });
      }
    });
  });
  expect(out.shell).toContain("side-loading");
  expect(out.chunks.join("")).toContain("data:/a");
  writeFileSync(resolve(artifactsDir, "write-before-resume.json"), JSON.stringify(out, null, 2));
});
