/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4965: after hydration, a write made in `onSettled` lands. The page reads a
 * server-adopted live `list` through `activeId = latest(list)[0]`; `scope`
 * only reads `activeId`, so it inherits that memo's verdict posture without
 * probing; a client-only async memo and a server-adopted live memo are keyed
 * on `scope`, the latter rendered under nested `<Show>`s. On rc.22–2.0.0 the
 * write was parked in a hold that never settled. Replays the shell
 * test/server/onsettled-inherited-posture-4965.gen.spec.tsx renders.
 */
import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { App } from "../harness/onsettled-inherited-posture-4965.jsx";
import { bootstrapHydrationGlobal } from "../harness/hydration-bootstrap.js";

const load = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../harness/__artifacts__/${name}.json`),
      "utf-8"
    )
  ) as { shell: string; chunks: string[] };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

test("#4965: a write in onSettled after hydration lands under an inherited latest() posture", async () => {
  const { shell, chunks } = load("onsettled-inherited-posture-4965");
  bootstrapHydrationGlobal();
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    for (const c of chunks) applyChunk(container, c, false);
    const block = container.querySelector("#block");
    expect(container.querySelector("#hydrated")!.textContent).toBe("no");
    dispose = hydrate(() => <App />, container);
    for (let i = 0; i < 6; i++) {
      await sleep(10);
      flush();
    }
    expect(container.querySelector("#hydrated")!.textContent).toBe("yes");
    expect(container.querySelector("#block")).toBe(block);
    expect(block!.textContent).toBe("free");
  } finally {
    dispose?.();
    container.remove();
  }
});
