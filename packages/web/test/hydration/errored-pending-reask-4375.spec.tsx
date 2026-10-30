/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4375: never refetch on hydration. The server answered `m0` with a
 * rejection and streamed it with the Loading's fragment, where the page
 * reads only `isPending(m1)` of the memo over it. Whether the client
 * hydrates after the fragment arrived (`loaded`) or boots mid-stream and
 * claims it when it arrives (`streamed`), it shows the server's text and
 * asks neither memo again until their input changes — the memos created in
 * the shell or in the boundary's content (`inside`), the input changed after
 * hydration or while a second boundary still streams (`slow`). The cause:
 * a reader created in the boundary's resume, on a later flush round than
 * the one the rejection landed in, retries the errored memo (PJ-R35), and
 * the retry ran the compute — a memo reading `latest(s)` makes its reader
 * a verdict reader that re-derives at the rejection, so the read is on a
 * later round. Replays the chunks
 * test/server/errored-pending-reask-4375.gen.spec.tsx renders.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  createPendingReaskApp,
  pendingReaskName,
  pendingReaskShapes
} from "../harness/errored-pending-reask-4375.jsx";
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
    await sleep(15);
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

describe("#4375: a served rejection read only through isPending, hydrated", () => {
  for (const o of pendingReaskShapes) {
    const name = pendingReaskName(o);
    for (const mode of ["loaded", "streamed"] as const) {
      test(`${name}: ${mode}`, async () => {
        const { shell, chunks } = load(name);
        bootstrapHydrationGlobal();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const container = document.createElement("div");
        document.body.appendChild(container);
        const { App, write, asks } = createPendingReaskApp(o);
        const main = () => container.querySelector("main")!;
        let dispose: (() => void) | undefined;
        try {
          applyChunk(container, shell, true);
          // `slow`, streamed: its fragment is held back past the write, so
          // the write lands while hydration is still open.
          const held = o.slow && mode === "streamed" ? chunks.slice(-1) : [];
          const first = chunks.slice(0, chunks.length - held.length);
          if (mode === "loaded") for (const c of first) applyChunk(container, c, false);
          dispose = hydrate(() => <App />, container);
          await settle();
          if (mode === "streamed") {
            expect(main().textContent).toBe(o.slow ? "[ROOT-L][SLOW-L]" : "[ROOT-L]");
            for (const c of first) {
              applyChunk(container, c, false);
              await settle();
            }
          }
          const tail = o.slow ? (held.length ? "[SLOW-L]" : "slow") : "";
          // The server's text; nothing asked, the served rejection claimed.
          expect(main().textContent).toBe("false" + tail);
          expect(asks()).toEqual([]);
          await settle();
          expect(main().textContent).toBe("false" + tail);
          expect(asks()).toEqual([]);

          // The input changes (mid-hydration for `slow`, streamed): both
          // memos ask, each question once, and the page stays live. Over
          // `latest(s)`, m0's frame pass asks the frame's `m0:5` (R5), the
          // parked flush re-derives it in the verdict lane for the
          // intermediate `1 + latest(s) + s()` (`m0:4`, `m1:5`), and the
          // landing adopts the frame's `m0:5` (F-9).
          write(2);
          await settle();
          expect(asks()).not.toContain("m0:3");
          if (o.latest) expect(asks()).toEqual(["m0:5", "m0:4", "m1:5", "m1:6"]);
          else expect(asks().slice(-2)).toEqual(["m0:5", "m1:6"]);
          for (const c of held) {
            applyChunk(container, c, false);
            await settle();
          }
          expect(main().textContent).toBe("false" + (o.slow ? "slow" : ""));
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
