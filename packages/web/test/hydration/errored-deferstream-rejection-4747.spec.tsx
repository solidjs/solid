/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4747: a source that rejected on the server inside an `<Errored>` hydrates
 * as a rejection whether or not it was `deferStream`. The boundary keeps the
 * server's fallback without a fetch, and `reset()` reruns the source as a
 * client fetch (#4273). Before the fix, a `deferStream` rejection went out as
 * a value: after `reset()` the content rendered the `Error` and the memo never
 * ran on the client.
 *
 * Replays the streamed output test/server/errored-deferstream-rejection-4747.gen.spec.tsx
 * records from the same components (test/harness/errored-deferstream-rejection-4747.tsx).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { enableHydration, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { AppDeferred, AppStreamed, env } from "../harness/errored-deferstream-rejection-4747.jsx";

enableHydration();
env.client = true;
const RealPromise = Promise;
env.RealPromise = RealPromise;

const load = (name: string) => {
  const { shell, chunks } = JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../harness/__artifacts__/errored-deferstream-rejection-4747-${name}.json`
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

function mount(container: HTMLElement, html: string) {
  delete (globalThis as any).$R;
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...html.matchAll(scriptRe)].map(m => m[1]);
  container.innerHTML = html.replace(scriptRe, "");
  for (const s of scripts) (0, eval)(s);
}

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  env.runs = 0;
  env.reset = undefined;
  uncaught.length = 0;
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
  process.off("unhandledRejection", onRejection);
  process.off("uncaughtException", onException);
});

test.each([
  ["streamed", AppStreamed],
  ["deferred", AppDeferred]
] as const)(
  "%s: the server's fallback is kept without a fetch, and reset() recovers by one client run",
  async (name, App) => {
    mount(container, load(name));
    const fb = container.querySelector(".fb");
    expect(fb?.textContent).toBe("x");
    dispose = hydrate(() => <App />, container);
    await drain();
    expect(container.querySelector(".fb")).toBe(fb);
    expect(env.runs).toBe(0);

    env.reset!();
    await drain(8);
    expect(env.runs).toBe(1);
    expect(container.querySelector(".content")?.textContent).toBe("client value");
    expect(container.querySelector(".fb")).toBeNull();
    expect(uncaught).toEqual([]);
  }
);
