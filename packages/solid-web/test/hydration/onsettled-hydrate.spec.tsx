/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Repro: `onSettled` in a component body must fire after hydration's first
 * stable render — it is 2.0's onMount + onCleanup replacement, so a
 * hydrating app that sets up autoscroll/subscriptions in it silently gets
 * NO setup if it never runs (observed live in the chat example).
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { flush, onSettled, createSignal, createMemo, Loading } from "solid-js";
import { hydrate, render } from "@solidjs/web";
import type * as WebServer from "../../types/server.js";

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
}

async function serverModule() {
  const serverEntry = new URL("./dist/server.js", `file://${process.cwd()}/`).href;
  return (await import(/* @vite-ignore */ serverEntry)) as typeof WebServer;
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

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
  await new Promise(r => setTimeout(r, 50));
}

describe("onSettled under hydration", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    delete (globalThis as any)._$HY;
  });

  test("client render: onSettled fires (control)", async () => {
    let ran = false;
    function App() {
      onSettled(() => {
        ran = true;
      });
      return <div>hello</div>;
    }
    dispose = render(() => <App />, container);
    await settle();
    expect(ran).toBe(true);
  });

  test("hydrate: onSettled in the component body fires", async () => {
    const server = await serverModule();
    function App() {
      onSettled(() => {
        (globalThis as any).__ranHydrate = true;
      });
      return <div>hello</div>;
    }
    const html = await streamHtml(server.renderToStream as any, () => <App />);
    setupHydration();
    mountStreamHtml(container, html);
    (globalThis as any).__ranHydrate = false;
    dispose = hydrate(() => <App />, container);
    await settle();
    expect((globalThis as any).__ranHydrate).toBe(true);
  });

  test("hydrate: onSettled fires with async in scope once it settles", async () => {
    const server = await serverModule();
    function App() {
      onSettled(() => {
        (globalThis as any).__ranAsync = true;
      });
      const data = createMemo(() => Promise.resolve("ready"));
      return (
        <Loading fallback={<p>wait</p>}>
          <div>{data()}</div>
        </Loading>
      );
    }
    const html = await streamHtml(server.renderToStream as any, () => <App />);
    setupHydration();
    mountStreamHtml(container, html);
    (globalThis as any).__ranAsync = false;
    dispose = hydrate(() => <App />, container);
    await settle();
    await settle();
    expect((globalThis as any).__ranAsync).toBe(true);
  });
});
