/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Truncation detection (#2958): a stream that ends before settling its
 * declared fragments must not leave boundaries waiting forever. The parser
 * finishing (DOMContentLoaded) is the document transport's close — a
 * `<key>_fr` declaration still unsettled then can never settle, because the
 * script that would resolve it executes during parse. The fragment ledger
 * marks each one rejected (an error-class write with a truncation error),
 * releases the boundary through its normal rejection path, and reports the
 * id as no longer pending — so hydration completes and document-adoption
 * waiters stop holding out for content that cannot come.
 *
 * Replays the real shell chunk artifact (late-boundary-after-done in the
 * parity harness) and then simply never delivers the rest of the stream.
 */
import { describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios } from "../harness/scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const scenario = scenarios.find(s => s.name === "late-boundary-after-done")!;

function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact for scenario "${name}". Run the server harness first: ` +
        `vitest run --config vite.config.server.mjs test/server/hydration-harness.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  return scripts;
}

function fragmentKey(shell: string): string {
  return shell.match(/_\$HY\.r\["([^"]+)_fr"\]/)![1];
}

describe("stream truncated before a declared fragment settles (#2958)", () => {
  test("the boundary releases through the rejection path and the ledger reports it done", async () => {
    const { shell } = loadArtifact(scenario.name);
    const key = fragmentKey(shell);
    const container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // The runtime boots while the document is still streaming — the only
    // window where the truncation sweep arms (a runtime loaded after parse
    // can't tell a completed page from a truncated one).
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });

    for (const s of applyChunk(container, shell, true)) (0, eval)(s);
    const dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();

    const hy = (globalThis as any)._$HY;
    // The boundary registered against the pending declaration and holds
    // hydration open; the ledger reports the fragment as still pending.
    expect(hy.done).toBeFalsy();
    expect(hy.fr.pending()).toBe(true);
    const notified: string[] = [];
    hy.fr.subscribe((id: string) => notified.push(id));

    // The connection drops: the parser finishes with the declaration
    // unsettled. Nothing else arrives — no content template, no $df, no
    // resolving script.
    Object.defineProperty(document, "readyState", { value: "interactive", configurable: true });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await sleep(20);
    flush();
    await sleep(20);
    flush();

    // The declaration became an error-class write (distinguishable from a
    // server-sent rejection by its error), the boundary released instead of
    // hanging, and the ledger stopped reporting the id as deliverable.
    const ref = hy.r[`${key}_fr`];
    expect(ref.s).toBe(2);
    expect(String(ref.v)).toContain("truncated");
    expect(notified).toContain(key);
    expect(hy.fr.pending()).toBe(false);
    expect(hy.done).toBe(true);

    warn.mockRestore();
    dispose();
    container.remove();
    delete (document as any).readyState;
  });
});
