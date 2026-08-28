/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Client half of the document-shell pattern tests (#3000) — see
 * test/harness/document-shell.tsx. The server rendered the full document
 * with the shell under <NoHydration> and the app re-entered via <Hydration>;
 * the client hydrates only the app subtree into #app-root. Everything must
 * wire up live: nodes claimed, events firing, effects updating the DOM.
 *
 * The markup is pinned by test/server/document-shell.spec.tsx against the
 * same shared source, so this cannot drift from real server output.
 */
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  App,
  AsyncApp,
  HeadShellApp,
  setHeadShellStarted,
  computeRuns,
  APP_ROOT_MARKUP
} from "../harness/document-shell.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Apply a server chunk the way a streaming browser parse would: markup into
// the DOM, inline scripts evaluated (they populate _$HY.r).
function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

describe("document-shell pattern — client hydrate (#3000)", () => {
  test("hydrating the island subtree claims nodes and stays reactive", async () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    document.body.innerHTML = `<div id="app-root">${APP_ROOT_MARKUP}</div>`;
    const root = document.getElementById("app-root")!;
    const serverButton = document.getElementById("counter")!;

    const dispose = hydrate(() => <App />, root);
    flush();
    await sleep(20);
    flush();

    // Claimed, not recreated.
    expect(document.getElementById("counter")).toBe(serverButton);

    // The hydrated effects are live: a delegated click updates the claimed
    // node (#3000's symptom was this staying frozen at "count: 0").
    serverButton.click();
    flush();
    expect(root.textContent).toBe("count: 1");
    serverButton.click();
    flush();
    expect(root.textContent).toBe("count: 2");

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    dispose();
  });

  test("async island: serialized reactive values adopt by id under the island namespace", async () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { chunks } = JSON.parse(
      readFileSync(resolve(artifactsDir, "document-shell-async.json"), "utf-8")
    ) as { chunks: string[] };

    const container = document.createElement("div");
    document.body.appendChild(container);
    chunks.forEach((c, i) => applyChunk(container, c, i === 0));

    const root = container.querySelector("#app-root") as HTMLElement;
    const serverSpan = root.querySelector("#data");
    const serverButton = root.querySelector("#bump") as HTMLElement;

    computeRuns.client = 0;
    const dispose = hydrate(() => <AsyncApp />, root);
    flush();
    await sleep(30);
    flush();
    await sleep(30);
    flush();

    // Claimed, and the serialized async record was adopted BY ID: the DOM
    // shows the server's value (the client compute would produce
    // "client-data") and the compute never ran. This is what breaks when
    // only element keys — not reactive ids — share the namespace.
    expect(root.querySelector("#data")).toBe(serverSpan);
    expect(root.querySelector("#data")!.textContent).toBe("server-data");
    expect(computeRuns.client).toBe(0);

    serverButton.click();
    flush();
    expect(root.querySelector("#bump")!.textContent).toBe("n: 1");

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    dispose();
    container.remove();
  });

  // Whole-document hydration where the server both INJECTED a head-manager
  // tag ahead of the shell's head children (the charset prelude) and
  // rewrote the shell's static <title> IN PLACE (data-dh + data-dhf). The
  // claim walk must skip the former and still claim the latter — before the
  // fix the injected tag shifted every positional read by one and hydration
  // for the whole document died on a null nextSibling (#3081).
  test("useHead + shell-authored head children hydrate against document (#3081)", async () => {
    const { chunks } = JSON.parse(
      readFileSync(resolve(artifactsDir, "document-shell-usehead-head.json"), "utf-8")
    ) as { chunks: string[] };
    const html = chunks.join("");

    // Recreate the served document in jsdom: documentElement/body attributes
    // by hand (innerHTML can't author them), head/body contents
    // byte-for-byte.
    for (const m of /<html([^>]*)>/.exec(html)![1].matchAll(/([\w-]+)(?:=("[^"]*"|\S+))?/g)) {
      document.documentElement.setAttribute(m[1], m[2] ? m[2].replace(/^"|"$/g, "") : "");
    }
    const bodyM = /<body([^>]*)>([\s\S]*)<\/body>/.exec(html)!;
    document.head.innerHTML = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
    for (const m of bodyM[1].matchAll(/([\w-]+)(?:=("[^"]*"|\S+))?/g)) {
      document.body.setAttribute(m[1], m[2] ? m[2].replace(/^"|"$/g, "") : "");
    }
    document.body.innerHTML = bodyM[2];

    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    setHeadShellStarted(false);
    const serverStatus = document.getElementById("status")!;
    const serverTitle = document.querySelector("title")!;
    expect(serverStatus.textContent).toBe("waiting");

    const dispose = hydrate(() => <HeadShellApp />, document);
    flush();
    await sleep(20);
    flush();

    // Post-hydration write must reach its bindings (the issue's canary —
    // with the walk broken, reactivity halts and this never lands).
    setHeadShellStarted(true);
    flush();

    expect(document.getElementById("status")).toBe(serverStatus);
    expect(serverStatus.textContent).toBe("started");
    expect(document.body.className).toBe("started");
    // The in-place-rewritten <title> was CLAIMED, not skipped as injected.
    expect(document.querySelector("title")).toBe(serverTitle);
    expect(serverTitle.textContent).toBe("managed title");

    // The client legitimately warns that a charset registration is
    // shell-only (it can never apply client-side); everything else is real.
    const noise = warn.mock.calls.map(c => String(c[0])).filter(m => !m.includes("shell-only"));
    expect(noise, noise.join("\n")).toEqual([]);
    warn.mockRestore();
    dispose();
  });
});
