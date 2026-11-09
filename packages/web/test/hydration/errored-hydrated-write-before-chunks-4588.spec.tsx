/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4588: an `<Errored>` the server drew as its fallback, over content whose
 * async `a` (keyed by the shell's `k`) fails on `k = 1` (the shapes:
 * test/harness/errored-hydrated-write-4588.tsx). #4273: the hydrated
 * fallback stays until a content input changes or reset() — never a refetch
 * on hydration otherwise. A write to `k` is the same user action whether it
 * lands before the streamed chunks arrive or after: once hydration reaches
 * the boundary, its content asks `a` again with the client's input and the
 * boundary recovers. With no write, nothing is asked. The issue is the
 * `around-inside` shapes: the Errored outside the streamed Loading, `a`
 * created in it — the fragment rejects, and its fresh render adopted the
 * server's answer for `k = 1` with no snapshot scope to mark it stale.
 * Replays the chunks test/server/errored-hydrated-write-4588.gen.spec.tsx
 * renders.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  createHydratedWriteApp,
  hydratedWriteName,
  hydratedWriteShapes
} from "../harness/errored-hydrated-write-4588.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

const load = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../harness/__artifacts__/${name}.json`),
      "utf-8"
    )
  ) as { shell: string; chunks: string[] };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function settle() {
  for (let i = 0; i < 4; i++) {
    await sleep(10);
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

type When = "before" | "after" | "none";

describe("#4588: a content-input write and the hydrated Errored fallback", () => {
  for (const o of hydratedWriteShapes) {
    const name = hydratedWriteName(o);
    for (const when of ["before", "after", "none"] as When[])
      test(`${name}: write ${when === "none" ? "never" : when + " the chunks"}`, async () => {
        const { shell, chunks } = load(name);
        bootstrapHydrationGlobal();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const container = document.createElement("div");
        document.body.appendChild(container);
        const { App, write, asks } = createHydratedWriteApp(o);
        const main = () => container.querySelector("main")!;
        const inShell = o.place === "shell" || (o.place === "around" && !o.inside);
        // Before the chunks, the fallback they bring, the recovered content.
        const [before, served, recovered] =
          o.place === "shell"
            ? ["[ERR][LOAD]", "[ERR]slow", "2slow"]
            : o.place === "streamed"
              ? ["[LOAD]", "[ERR]sib", "2sib"]
              : ["[LOAD]", "[ERR]", "2sib"];
        let dispose: (() => void) | undefined;
        try {
          applyChunk(container, shell, true);
          dispose = hydrate(() => <App />, container);
          await settle();
          expect(main().textContent).toBe(before);
          expect(asks()).toEqual([]);

          // The write lands while the page is still streaming. Memos the
          // shell created ask now (a write before resume); memos in the
          // streamed section do not exist yet: nothing asks.
          if (when === "before") {
            write(2);
            await settle();
            if (!inShell) expect(asks()).toEqual([]);
          }
          for (const c of chunks) applyChunk(container, c, false);
          await settle();

          if (when === "before") {
            // Hydration reached the boundary: the content asks again with
            // the client's input, once, and the boundary recovers.
            expect(asks()).toEqual(["err:2"]);
            expect(main().textContent).toBe(recovered);
          } else {
            // The server's fallback, claimed; nothing asked.
            expect(main().textContent).toBe(served);
            expect(asks()).toEqual([]);
            if (when === "after") {
              write(2);
              await settle();
              expect(asks()).toEqual(["err:2"]);
              expect(main().textContent).toBe(recovered);
            } else {
              await settle();
              expect(main().textContent).toBe(served);
              expect(asks()).toEqual([]);
            }
          }
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
});
