/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4570: a client write during the hydration window, while a streamed
 * boundary is still out, re-arms a `<Loading on>` nested in it. When the
 * server's answer streams in, the boundary resumes against the server
 * snapshot and catches up to the write. The re-arm's data (`a1`) is also
 * read outside the inner boundary, so its fallback is never shown (D-16):
 * the catch-up holds the whole content on the snapshot until `a1:1` lands
 * (F-2), and no frame shows the inner fallback beside the snapshot's answer
 * (F-1). The inner fallback is never claimed against the server's markup,
 * which never rendered it: no "Hydration key miss", no detached element.
 * Nothing the server answered is asked again. Replays the chunks
 * test/server/hydration-write-rearm-4570.gen.spec.tsx renders.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  createWriteRearmApp,
  writeRearmName,
  writeRearmShapes,
  type WriteRearmShape
} from "../harness/hydration-write-rearm-4570.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

const load = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../harness/__artifacts__/${name}.json`),
      "utf-8"
    )
  ) as { shell: string; chunks: string[] };

// What the screen shows once the server's answer has streamed in (the write
// already made), and once the client's own question lands.
//  - shared: `a1` is read outside the inner boundary, so the re-arm's
//    fallback is never shown (D-16); the catch-up holds the whole content on
//    the snapshot until `a1:1` lands (F-2, F-1).
//  - own: nothing outside waits on `a2:1`, so the re-arm's fallback shows
//    now (D-15), created fresh: the server never rendered it.
const expected: Record<WriteRearmShape, { resumed: string; landed: string; asks: string[] }> = {
  shared: { resumed: "La1=10a1=10", landed: "La1=11a1=11", asks: ["a1:1"] },
  own: { resumed: "F1a1=10", landed: "La2=11a1=10", asks: ["a2:1"] }
};
const lands: Record<WriteRearmShape, string> = { shared: "a1:1", own: "a2:1" };

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

describe("#4570: a write in the hydration window re-arms a nested Loading", () => {
  for (const o of writeRearmShapes) {
    test(o, async () => {
      const artifact = load(writeRearmName(o));
      bootstrapHydrationGlobal();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const container = document.createElement("div");
      document.body.appendChild(container);
      const { App, write, land, asks } = createWriteRearmApp(o);
      const text = () => container.querySelector("main")!.textContent;
      let dispose: (() => void) | undefined;
      try {
        applyChunk(container, artifact.shell, true);
        dispose = hydrate(() => <App />, container);
        await settle();
        expect(text()).toBe("F0");

        // The write lands while the server's answer is still out.
        write(1);
        await settle();
        expect(text()).toBe("F0");

        // The server's answer streams in: the boundary resumes on the
        // snapshot, then catches up to the write.
        for (const c of artifact.chunks) {
          applyChunk(container, c, false);
          await settle();
        }
        expect(text()).toBe(expected[o].resumed);
        // Every node on screen is in the document: nothing rendered detached.
        for (const p of container.querySelectorAll("main p, main i"))
          expect(p.isConnected).toBe(true);

        land(lands[o], 11);
        await settle();
        expect(text()).toBe(expected[o].landed);
        // Nothing the server answered is asked again.
        expect(asks()).toEqual(expected[o].asks);

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
