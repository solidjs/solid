/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the document live-channel parity pair (see
 * test/harness/document-live-channel.tsx). Renders the streaming component
 * inline at t=0 through the frame sink and writes the chunk artifact
 * test/hydration/document-live-channel.spec.tsx replays into jsdom.
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";
import { FID, YIELDS, makeStreamingComponent } from "../harness/document-live-channel.jsx";

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

describe("document live channel — server render (writes the artifact)", () => {
  test("first yield in the markup, later yields as channel ops, document completes", async () => {
    const Inline = frameTransformDirectResult(makeStreamingComponent(), { id: FID }) as any;
    const { shell, rest } = await collectChunks(() => Inline({}));
    const full = shell + rest;

    // The first yield is the page's truth, marker-wrapped as a hole.
    expect(full).toMatch(/<!--lh:(\d+)-->w1<!--lh:\/\1-->/);
    // Every later yield rode the channel as a `hole` op, exactly once; the
    // last one appears nowhere else (no second markup rendering).
    for (const later of YIELDS.slice(1)) expect(full.split(`html:"${later}"`).length).toBe(2);
    expect(full.split(YIELDS[YIELDS.length - 1]).length).toBe(2);
    expect(full).toContain("sc:live");

    writeFileSync(
      resolve(artifactsDir, "document-live-channel-streamed.json"),
      JSON.stringify({ name: "document-live-channel-streamed", shell, rest }, null, 2)
    );
  });
});
