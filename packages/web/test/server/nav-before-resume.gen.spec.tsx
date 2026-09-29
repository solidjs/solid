/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/nav-before-resume.spec.tsx:
 * renders the router-shaped page and writes its shell plus each later chunk.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { createNavApp } from "../harness/nav-before-resume.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

const storage = new AsyncLocalStorage<any>();
(globalThis as any)[Symbol.for("solid.RequestContext")] = storage;

test("render nav-before-resume chunks", async () => {
  const { App } = createNavApp();
  const event = {
    request: new Request("http://localhost/a"),
    locals: {},
    response: { status: 200, headers: new Headers() }
  };
  const out = await storage.run(
    event,
    () =>
      new Promise<{ shell: string; chunks: string[] }>(done => {
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
      })
  );
  const all = out.shell + out.chunks.join("");
  expect(out.shell).toContain("title:/a");
  expect(out.shell).toContain("side-loading");
  expect(out.shell).toContain("a-loading");
  expect(all).toContain("a-data");
  expect(all).toContain("side-data");
  expect(all).toContain('"lib:side"');
  writeFileSync(resolve(artifactsDir, "nav-before-resume.json"), JSON.stringify(out, null, 2));
});
