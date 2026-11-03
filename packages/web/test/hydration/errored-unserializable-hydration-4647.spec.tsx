/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4647: an async memo whose value the server could not serialize, after the
 * first flush (midstream; before it the render fails, see
 * test/server/stream-async-serialize-failure-4647.spec.tsx). The server
 * rendered the content and completed; its payload rejects the memo's key
 * with a serialization error naming it (maintainer ruling, 2026-11-03).
 * Hydrating, the memo takes that rejection like any server-rejected key
 * (#4273): it throws into the nearest `<Errored>`, whose fallback replaces the
 * server's content, and nothing is fetched on hydration. (The record is left
 * unmarked, so the rejection lands after the claim pass, where the fallback
 * can replace markup that is the content's.) The fallback stays until reset()
 * or one of the memo's inputs changes; either reruns the memo as a client
 * fetch, which needs no serialization. Without an `<Errored>` the rejection
 * goes where any other rejected key's goes.
 *
 * Replays the streamed output test/server/errored-unserializable-4647.gen.spec.tsx
 * records from the same components (test/harness/errored-unserializable-4647.tsx).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { enableHydration, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { AppBare, AppInside, AppOutside, env } from "../harness/errored-unserializable-4647.jsx";

enableHydration();
env.client = true;
const RealPromise = Promise;
env.RealPromise = RealPromise;

const load = (name: string) => {
  const { shell, chunks } = JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../harness/__artifacts__/errored-unserializable-4647-${name}.json`
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

const message = (key: string) =>
  `Serialization failed: the hydration value for key "${key}" could not be serialized on the server`;

describe("#4647: a key that failed to serialize midstream rejects into Errored on hydration", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    env.runs = 0;
    env.setters = {};
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

  test("the fallback replaces the server's content, without a fetch; it holds; reset() recovers by one client run", async () => {
    mount(container, load("inside"));
    const main = container.querySelector("main");
    const ok = container.querySelector(".ok");
    expect(container.querySelector(".content")?.textContent).toBe("server value");
    dispose = hydrate(() => <AppInside />, container);
    await drain();
    expect(container.querySelector("main")).toBe(main);
    expect(container.querySelector(".ok")).toBe(ok);
    expect(ok?.textContent).toBe("fine");
    expect(container.querySelector(".content")).toBeNull();
    expect(container.querySelector(".fb")?.textContent).toBe(message("400000"));
    expect(env.runs).toBe(0);

    // The fallback holds: nothing reruns the memo on its own.
    await drain(6);
    expect(container.querySelector(".fb")?.textContent).toBe(message("400000"));
    expect(env.runs).toBe(0);

    env.setters.reset!();
    await drain(8);
    expect(env.runs).toBe(1);
    expect(container.querySelector("main")).toBe(main);
    expect(container.querySelector(".content")?.textContent).toBe("pear 1");
    expect(container.querySelector(".fb")).toBeNull();
    expect(uncaught).toEqual([]);
  });

  test("an input change recovers by one client run", async () => {
    mount(container, load("inside"));
    dispose = hydrate(() => <AppInside />, container);
    await drain();
    expect(container.querySelector(".fb")?.textContent).toBe(message("400000"));
    expect(env.runs).toBe(0);

    env.setters.sel!(2);
    await drain(8);
    expect(env.runs).toBe(1);
    expect(container.querySelector(".content")?.textContent).toBe("pear 2");
    expect(container.querySelector(".fb")).toBeNull();
    expect(uncaught).toEqual([]);
  });

  test("a memo outside the boundary: its readers' Errored catches it, and an input change recovers", async () => {
    mount(container, load("outside"));
    dispose = hydrate(() => <AppOutside />, container);
    await drain();
    expect(container.querySelector(".content")).toBeNull();
    expect(container.querySelector(".fb")?.textContent).toBe(message("4000"));
    expect(env.runs).toBe(0);

    env.setters.sel!(3);
    await drain(8);
    expect(env.runs).toBe(1);
    expect(container.querySelector(".content")?.textContent).toBe("pear 3");
    expect(uncaught).toEqual([]);
  });

  test("without an Errored: the same as any other rejected key, and no fetch", async () => {
    const html = load("bare");
    const report: Record<string, unknown> = {};
    for (const [name, page] of [
      ["serialize", html],
      ["plainReject", html.replace(/new Error\("Serialization failed[^)]*\)/, 'new Error("boom")')]
    ] as const) {
      uncaught.length = 0;
      env.runs = 0;
      const c = document.createElement("div");
      document.body.appendChild(c);
      mount(c, page);
      let threw = "";
      let d: (() => void) | undefined;
      try {
        d = hydrate(() => <AppBare />, c);
        await drain();
      } catch (e: any) {
        threw = e?.message;
      }
      await drain();
      report[name] = { threw, uncaught: [...uncaught], runs: env.runs, html: c.innerHTML };
      d?.();
      c.remove();
    }
    expect((report.serialize as { runs: number }).runs).toBe(0);
    expect(
      JSON.stringify(report.serialize).replaceAll(
        JSON.stringify(message("4000")).slice(1, -1),
        "boom"
      )
    ).toBe(JSON.stringify(report.plainReject));
    uncaught.length = 0;
  });
});
