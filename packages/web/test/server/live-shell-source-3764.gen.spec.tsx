/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/hydration/live-shell-source-3764.spec.tsx.
 */
import { expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { A, B, C } from "../harness/live-shell-source-3764.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

function render(App: () => any) {
  return new Promise<{ shell: string; chunks: string[] }>(done => {
    const chunks: string[] = [];
    let shell: string | undefined;
    let shellDone = false;
    renderToStream(App, {
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
}

test("render #3764 chunks", async () => {
  const a = await render(() => <A liveMs={0} />);
  const b = await render(() => <B liveMs={0} />);
  const c = await render(() => <C liveMs={0} />);
  expect(c.chunks.join("")).toContain("rows: ");
  expect(a.chunks.join("")).toContain("rows: ");
  expect(b.chunks.join("")).toContain("<li");
  writeFileSync(
    resolve(artifactsDir, "live-shell-source-3764.json"),
    JSON.stringify({ a, b, c }, null, 2)
  );
});
