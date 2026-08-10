/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Truncation must handle EVERY pending registry ref, not just `_fr` boundary
 * declarations. The registry also carries plain serialized promises —
 * owner-id computation values and library-keyed data refs (@solidjs/router's
 * query channel serializes under `name + hashKey(args)`). A stream that dies
 * mid-flight leaves those forever-pending. The settle scripts execute during
 * parse, so at DOMContentLoaded every still-pending seroval resolver
 * (`self.$R`) is dead — and the sweep answers per consumption state:
 *
 * - an entry a keyed consumer already claimed one-shot (adopt + delete, the
 *   router's pattern) REJECTS through its resolver: the bare promise is the
 *   only channel left to that consumer, and its .then chain handles errors —
 *   without this, every query() awaiting it hangs permanently;
 * - an entry still in the registry is DELETED: future presence checks
 *   (sharedConfig.has) fall through to a fresh compute/fetch instead of
 *   adopting a promise that can never settle, and live owner-id adopters are
 *   not crashed by a rejection no boundary can route.
 *
 * Replays the real shell chunk artifact (late-boundary-after-done) with two
 * extra keyed promise refs seeded the way the wire writes them, then never
 * delivers the rest of the stream.
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

// The exact wire idiom for a pending keyed promise: the promise lands in the
// registry, its resolver triple ({p, s, f}) in seroval's cross-reference
// scope, and the settle script (which will never arrive here) would fire the
// resolver and stamp `.s`/`.v`.
function seedPendingRef(key: string, refIndex: number) {
  (0, eval)(
    `_$HY.r[${JSON.stringify(key)}]=$R[${refIndex}]=($R[${refIndex + 1}]=(()=>{` +
      `const r={p:0,s:0,f:0};r.p=new Promise((s,f)=>{r.s=s;r.f=f});return r})()).p;`
  );
}

describe("stream truncated with pending non-fragment registry refs", () => {
  test("consumed and unconsumed keyed promises both reject instead of hanging", async () => {
    const { shell } = loadArtifact(scenario.name);
    const container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    delete (globalThis as any).$R;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });

    for (const s of applyChunk(container, shell, true)) (0, eval)(s);
    // Two keyed data refs the stream declared but will never settle (high
    // indices keep clear of the artifact's own cross-references).
    seedPendingRef("todos[1]", 900);
    seedPendingRef("user[2]", 902);

    const hy = (globalThis as any)._$HY;

    // A router-style consumer claims one entry before the connection drops:
    // it adopts the promise and deletes the registry key (one-shot
    // consumption), so by truncation time only the promise itself remains.
    const adopted: Promise<any> = hy.r["todos[1]"];
    delete hy.r["todos[1]"];
    let adoptedState = "pending";
    adopted.then(
      () => (adoptedState = "resolved"),
      () => (adoptedState = "rejected")
    );

    const dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();

    // Nothing settles while the stream is merely slow.
    expect(adoptedState).toBe("pending");
    expect(hy.r["user[2]"].s).toBeFalsy();

    // The connection drops: the parser finishes with everything unsettled.
    Object.defineProperty(document, "readyState", { value: "interactive", configurable: true });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await sleep(20);
    flush();
    await sleep(20);
    flush();

    // The adopted promise rejects even though its registry key is long gone —
    // the sweep works through the resolvers, not the registry keys.
    expect(adoptedState).toBe("rejected");
    let adoptedError: any;
    await adopted.catch((e: any) => (adoptedError = e));
    expect(String(adoptedError)).toContain("truncated");
    // Stamped like a server-sent rejection for status-based readers.
    expect((adopted as any).s).toBe(2);

    // The unconsumed entry is removed: a late keyed consumer's presence
    // check misses and it fetches fresh instead of adopting a promise that
    // can never settle.
    expect("user[2]" in hy.r).toBe(false);

    // The fragment path is untouched: the boundary still releases and
    // hydration still completes.
    expect(hy.r[`${fragmentKey(shell)}_fr`].s).toBe(2);
    expect(hy.done).toBe(true);

    warn.mockRestore();
    dispose();
    container.remove();
    delete (document as any).readyState;
  });
});

function fragmentKey(shell: string): string {
  return shell.match(/_\$HY\.r\["([^"]+)_fr"\]/)![1];
}
