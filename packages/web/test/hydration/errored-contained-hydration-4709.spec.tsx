/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4709 (review): a streamed memo whose rejection an `<Errored>` contained
 * on the server, with an error the default serializer could not encode. The
 * server drew the fallback and sent the memo's key as a rejection carrying a
 * plain `Error` with the message, marked as seroval marks one. Hydrating,
 * the memo throws it in the claim pass, so the boundary adopts the server's
 * fallback as it does when the error encodes: no fetch, nothing pending.
 * (Left unmarked, the read is still pending in the claim pass and the root
 * mount waits on it.) reset() reruns the memo as a client fetch.
 *
 * Replays the streamed output test/server/errored-contained-4709.gen.spec.tsx
 * records from the same component (test/harness/errored-contained-4709.tsx).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enableHydration, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { App, env } from "../harness/errored-contained-4709.jsx";

enableHydration();
env.client = true;
const RealPromise = Promise;
env.RealPromise = RealPromise;

const load = (name: string) => {
  const { shell, chunks } = JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../harness/__artifacts__/errored-contained-4709-${name}.json`
      ),
      "utf-8"
    )
  ) as { shell: string; chunks: string[] };
  return shell + chunks.join("");
};

async function drain(n = 3) {
  for (let i = 0; i < n; i++) {
    await new RealPromise(r => setTimeout(r, 5));
    flush();
  }
}

const uncaught: string[] = [];
const onRejection = (e: any) => void uncaught.push("unhandledRejection:" + (e?.message || e));
const onException = (e: any) => void uncaught.push("uncaughtException:" + (e?.message || e));

/** The page as a browser that got the whole response would hold it. */
function mount(container: HTMLElement, html: string) {
  delete (globalThis as any).$R;
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...html.matchAll(scriptRe)].map(m => m[1]);
  container.innerHTML = html.replace(scriptRe, "");
  for (const s of scripts) (0, eval)(s);
}

describe("#4709: a contained streamed rejection hydrates into the server's fallback", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;
  let warned: string[];
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    env.runs = 0;
    env.reset = undefined;
    uncaught.length = 0;
    warned = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(" "));
    });
    process.on("unhandledRejection", onRejection);
    process.on("uncaughtException", onException);
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    vi.restoreAllMocks();
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onException);
  });

  // "encoded" is the control: the error serializes and seroval marks it.
  test.each(["plain", "encoded"])(
    "%s: the fallback is adopted without a fetch, and reset() recovers by one client run",
    async name => {
      mount(container, load(name));
      const main = container.querySelector("main");
      const fb = container.querySelector(".fb");
      expect(fb?.textContent).toBe("x");
      dispose = hydrate(() => <App />, container);
      await drain();
      expect(container.querySelector("main")).toBe(main);
      expect(container.querySelector(".fb")).toBe(fb);
      expect(container.querySelector(".content")).toBeNull();
      expect(env.runs).toBe(0);
      expect(warned).toEqual([]);

      env.reset!();
      await drain(8);
      expect(env.runs).toBe(1);
      expect(container.querySelector(".content")?.textContent).toBe("client value");
      expect(container.querySelector(".fb")).toBeNull();
      expect(uncaught).toEqual([]);
    }
  );

  test("the plain record carries the message and nothing else, marked as a rejection", () => {
    mount(container, load("plain"));
    const records = Object.values((globalThis as any)._$HY.r as Record<string, any>);
    const rejected = records.filter(r => typeof r?.then === "function");
    expect(rejected.map(r => [r.s, r.v.message, Object.keys(r.v)])).toEqual([[2, "x", []]]);
    for (const r of rejected) r.catch(() => {});
  });
});
