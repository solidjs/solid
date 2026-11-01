/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4588: a client write to a content input of an `<Errored>` whose failure
 * the server streams. The hydrated boundary keeps the server's fallback,
 * with no ask, until a content input changes (#4273). Whether the write
 * lands after the fragment arrived (`after`) or while the server's answer
 * is still out (`before`), the boundary re-asks with the new input once
 * hydration reaches it and recovers with the content. A memo created in the
 * boundary's content (`inside`) first exists in the fresh render after the
 * rejection: that render reads the server's snapshot, so the memo adopts
 * the server's error for it and replays the write at release — it was
 * created against the written input and adopted the error for the old one,
 * and the write was lost. Replays the chunks
 * test/server/hydration-errored-write-4588.gen.spec.tsx renders.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  createErroredWriteApp,
  erroredWriteName,
  erroredWriteShapes,
  type ErroredWriteShape
} from "../harness/hydration-errored-write-4588.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

const load = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../harness/__artifacts__/${name}.json`),
      "utf-8"
    )
  ) as { shell: string; chunks: string[] };

// What the screen shows between the re-ask and its landing. A shell memo
// written before the fragment arrives asks at the write, so the fresh
// render finds it pending; otherwise the server's fallback stays up.
const asked: Record<ErroredWriteShape, Record<"after" | "before", string>> = {
  shell: { after: "err:0", before: "F0" },
  inside: { after: "err:0", before: "err:0" }
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(5);
    flush();
  }
}

function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

afterEach(async () => {
  await sleep(0);
  delete (globalThis as any)._$HY;
});

describe("#4588: a write to a hydrated Errored's content input", () => {
  for (const o of erroredWriteShapes) {
    for (const when of ["after", "before"] as const) {
      test(`${o}: written ${when} the failure arrives`, async () => {
        const artifact = load(erroredWriteName(o));
        bootstrapHydrationGlobal();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const container = document.createElement("div");
        document.body.appendChild(container);
        const { App, write, land, asks } = createErroredWriteApp(o);
        const text = () => container.querySelector("main")!.textContent;
        let dispose: (() => void) | undefined;
        try {
          applyChunk(container, artifact.shell, true);
          dispose = hydrate(() => <App />, container);
          await settle();
          expect(text()).toBe("F0");

          if (when === "before") {
            write(1);
            await settle();
            expect(text()).toBe("F0");
          }

          for (const c of artifact.chunks) {
            applyChunk(container, c, false);
            await settle();
          }
          if (when === "after") {
            // The server's fallback, claimed; nothing asked.
            expect(text()).toBe("err:0");
            expect(asks()).toEqual([]);
            write(1);
            await settle();
          }
          expect(asks()).toEqual(["err:1"]);
          expect(text()).toBe(asked[o][when]);

          land("err:1", 11);
          await settle();
          expect(text()).toBe("a1=11");
          for (const p of container.querySelectorAll("main p")) expect(p.isConnected).toBe(true);

          const diagnostics = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
          expect(diagnostics).toEqual([]);
        } finally {
          dispose?.();
          container.remove();
          warn.mockRestore();
          error.mockRestore();
        }
      });
    }
  }
});
