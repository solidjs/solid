/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Hydration safety for `clientOnly`: the server renders only the fallback
 * (via the built server bundle, like the other hydration parity specs), the
 * client hydrates the same fallback with no mismatch — the mounted gate
 * keeps the wrapped component out of the hydration pass — and the real
 * component swaps in only after settle + module load.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { flush, type Component } from "solid-js";
import { hydrate, clientOnly } from "@solidjs/web";
import type * as WebServer from "../../types/server.js";

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
}

async function serverModule() {
  const serverEntry = new URL("./dist/server.js", `file://${process.cwd()}/`).href;
  return (await import(/* @vite-ignore */ serverEntry)) as typeof WebServer & {
    clientOnly: typeof clientOnly;
  };
}

function streamHtml(renderToStream: typeof WebServer.renderToStream, code: () => any) {
  return new Promise<string>(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write(chunk: string) {
        chunks.push(String(chunk));
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

function mountStreamHtml(container: HTMLDivElement, html: string) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...html.matchAll(scriptRe)].map(match => match[1]);
  container.innerHTML = html.replace(scriptRe, "");
  for (const script of scripts) (0, eval)(script);
}

async function settleHydration() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
  await new Promise(r => setTimeout(r, 50));
}

function expectNoHydrationWarnings(warn: ReturnType<typeof vi.spyOn>) {
  const bad = warn.mock.calls.filter(
    (c: unknown[]) =>
      typeof c[0] === "string" &&
      (c[0].includes("unclaimed server-rendered node") || c[0].includes("expected <"))
  );
  expect(bad).toHaveLength(0);
}

describe("clientOnly hydration", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    if (dispose) dispose();
    await new Promise(r => setTimeout(r, 0));
    setupHydration();
    container.innerHTML = "";
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
  });

  test("hydrates the fallback without mismatch, then swaps the loaded component in", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = await serverModule();

    // Server side: the import must never start; only the fallback renders.
    const serverImporter = vi.fn(() =>
      Promise.resolve({ default: (() => "widget") as Component<{}> })
    );
    const ServerWidget = server.clientOnly(serverImporter);
    const html = await streamHtml(server.renderToStream, () =>
      ServerWidget({ fallback: "fallback-content" })
    );
    expect(html).toContain("fallback-content");
    expect(serverImporter).not.toHaveBeenCalled();

    setupHydration();
    mountStreamHtml(container, html);
    expect(container.textContent).toContain("fallback-content");

    // Client side: module load is gated behind a deferred we control.
    let resolveModule!: () => void;
    const modulePromise = new Promise<{ default: Component<{}> }>(r => {
      resolveModule = () => r({ default: () => "widget" as any });
    });
    const Widget = clientOnly(() => modulePromise);

    dispose = hydrate(() => Widget({ fallback: "fallback-content" } as any), container);

    // Still the fallback during the hydration pass (mounted gate).
    expect(container.textContent).toContain("fallback-content");

    resolveModule();
    await settleHydration();

    expect(container.textContent).toContain("widget");
    expect(container.textContent).not.toContain("fallback-content");
    expectNoHydrationWarnings(warn);
    warn.mockRestore();
  });

  test("stays on the fallback (no mismatch) while the module is still loading after settle", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = await serverModule();

    const ServerWidget = server.clientOnly(() =>
      Promise.resolve({ default: (() => "widget") as Component<{}> })
    );
    const html = await streamHtml(server.renderToStream, () =>
      ServerWidget({ fallback: "fallback-content" })
    );

    setupHydration();
    mountStreamHtml(container, html);

    // Never resolves during the test.
    const Widget = clientOnly(() => new Promise<{ default: Component<{}> }>(() => {}));
    dispose = hydrate(() => Widget({ fallback: "fallback-content" } as any), container);

    await settleHydration();

    expect(container.textContent).toContain("fallback-content");
    expectNoHydrationWarnings(warn);
    warn.mockRestore();
  });
});
