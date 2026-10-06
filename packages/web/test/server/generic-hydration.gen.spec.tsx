/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of test/consistency/generic/** (the frames-free hydration
 * consistency pins and harness): renders test/harness/generic-hydration.tsx
 * in both fragment orders and writes the shell plus each later chunk.
 */
import { expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { createGenericApp, type Order } from "../harness/generic-hydration.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

async function renderOrder(order: Order) {
  const { App } = createGenericApp(order);
  return new Promise<{ shell: string; chunks: string[] }>(done => {
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
}

for (const order of ["ab", "ba"] as Order[]) {
  test(`render generic-hydration chunks (${order})`, async () => {
    const out = await renderOrder(order);
    expect(out.shell).toContain("a-loading");
    expect(out.shell).toContain("b-loading");
    expect(out.shell).toContain("label:/a");
    // The fragments land in the order the server settled them (`shared`
    // lands between — in its own chunk or batched with a neighbour).
    const all = out.chunks.join("");
    const first = all.indexOf(order === "ab" ? "data:a" : "data:b");
    const second = all.indexOf(order === "ab" ? "data:b" : "data:a");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(all).toContain("shared:/a");
    expect(out.chunks.length).toBeGreaterThanOrEqual(2);
    expect(out.chunks.length).toBeLessThanOrEqual(3);
    writeFileSync(
      resolve(artifactsDir, `generic-hydration-${order}.json`),
      JSON.stringify(out, null, 2)
    );
  });
}
