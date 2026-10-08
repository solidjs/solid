/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of #3889. Renders one server-component factory at two sites
 * and writes the artifact the hydration spec replays.
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import { ARTIFACT, FID, makeApp, makeMultisite } from "../harness/multisite-hydration-3889.jsx";

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

describe("shared server-component factory (#3889) — server render", () => {
  test("two mounts of one factory each render a counter", async () => {
    const Factory = frameTransformDirectResult(makeMultisite(), { id: FID, args: [] }) as any;
    const App = makeApp(() => Promise.resolve(Factory));
    const { shell, rest } = await collectChunks(() => <App />);
    const full = shell + rest;
    const visible = full.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");

    expect(visible).not.toContain("pending");
    expect(full.match(/<button\b/g)?.length).toBe(2);
    // The first site keeps the function id. Each later site stamps its own
    // scope on `data-fid` and groups under the function with `data-fn`, and
    // the two counters take distinct hydration keys.
    expect(full).toContain(`data-fid="${FID}"`);
    expect(full).toContain(`data-fn="${FID}"`);
    const keys = [...full.matchAll(/_hk=([^ >]+)/g)].map(m => m[1]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);

    writeFileSync(
      resolve(artifactsDir, `${ARTIFACT}.json`),
      JSON.stringify({ name: ARTIFACT, shell, rest }, null, 2)
    );
  });
});
