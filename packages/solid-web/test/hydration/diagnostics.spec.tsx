/**
 * @jsxImportSource solid-js
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { sharedConfig, createMemo, createSignal, flush, Errored, Loading } from "solid-js";
import { hydrate, insert } from "@solidjs/web";
import type * as WebServer from "../../types/server.js";

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

async function renderStreamHtml(code: () => any): Promise<string> {
  const serverEntry = "../../dist/server.js" as string;
  const { renderToStream } = (await import(serverEntry)) as typeof WebServer;
  return new Promise(resolve => {
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

describe("Phase 1: Hydration error diagnostics", () => {
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

  test("warns on tag mismatch between claimed node and JSX template", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    container.innerHTML = '<span _hk="0">Wrong tag</span>';

    dispose = hydrate(() => <div>Expected div</div>, container);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("expected <div> but found"),
      expect.any(Object)
    );
    warn.mockRestore();
  });

  test("no tag mismatch warning when tags match", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    container.innerHTML = '<div _hk="0">Content</div>';

    dispose = hydrate(() => <div>Content</div>, container);

    const tagWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("tag mismatch")
    );
    expect(tagWarns).toHaveLength(0);
    warn.mockRestore();
  });

  test("orphan detection fires automatically via drainHydrationCallbacks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    container.innerHTML = '<div _hk="0">Claimed</div><span _hk="1">Orphan</span>';

    dispose = hydrate(() => <div>Claimed</div>, container);

    // verifyHydration fires inside setTimeout in drainHydrationCallbacks
    await new Promise(r => setTimeout(r, 50));

    const orphanWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns.length).toBeGreaterThanOrEqual(1);
    expect(orphanWarns[0][0]).toContain("<span");
    warn.mockRestore();
  });

  test("late Loading rejection hydrates without orphan warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejected: Promise<{ title: string }> = Promise.reject(
      new Error("Item bad-item not found")
    );
    rejected.catch(() => {});
    const html = await renderStreamHtml(() => {
      const item = createMemo(() => rejected);
      return (
        <Errored fallback={(e: any) => `ItemError: ${String(e.message || e)}`}>
          <Loading fallback={"Item Loading..."}>{item().title as any}</Loading>
        </Errored>
      );
    });

    setupHydration();
    mountStreamHtml(container, html);

    dispose = hydrate(() => {
      const item = createMemo(() => rejected);
      return (
        <Errored fallback={(e: any) => `ItemError: ${String(e.message || e)}`}>
          <Loading fallback={"Item Loading..."}>{item().title as any}</Loading>
        </Errored>
      );
    }, container);

    await Promise.resolve();
    await Promise.resolve();
    flush();
    await new Promise(r => setTimeout(r, 50));

    expect(container.textContent).toBe("ItemError: Item bad-item not found");
    expect(container.innerHTML).not.toContain('id="pl-0"');

    const orphanWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("Phase 2: Walk validation", () => {
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

  test("getFirstChild warns on browser-corrected structure (tbody insertion)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("Cell");

    container.innerHTML = '<table _hk="0"><tbody><tr><td>Cell</td></tr></tbody></table>';

    dispose = hydrate(
      () => (
        <table>
          <tr>
            <td>{text()}</td>
          </tr>
        </table>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns.length).toBeGreaterThanOrEqual(1);
    expect(structureWarns[0][0]).toContain("expected <tr>");
    warn.mockRestore();
  });

  test("getNextSibling warns when sibling has wrong tag", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("dynamic");

    container.innerHTML =
      '<div _hk="0"><header>Title</header><div>Wrong tag</div><footer>End</footer></div>';

    dispose = hydrate(
      () => (
        <div>
          <header>Title</header>
          <main>{text()}</main>
          <footer>End</footer>
        </div>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns.length).toBeGreaterThanOrEqual(1);
    expect(structureWarns[0][0]).toContain("expected <main>");
    warn.mockRestore();
  });

  test("getFirstChild warns on missing child", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("item");

    container.innerHTML = '<ul _hk="0"></ul>';

    dispose = hydrate(
      () => (
        <ul>
          <li>{text()}</li>
        </ul>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns.length).toBeGreaterThanOrEqual(1);
    const viz = structureWarns[0][2] as string;
    expect(viz).toContain("missing");
    warn.mockRestore();
  });

  test("no structure warnings on correct hydration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("dynamic");

    container.innerHTML =
      '<div _hk="0"><header>Title</header><main>dynamic</main><footer>End</footer></div>';

    dispose = hydrate(
      () => (
        <div>
          <header>Title</header>
          <main>{text()}</main>
          <footer>End</footer>
        </div>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns).toHaveLength(0);
    warn.mockRestore();
  });

  test("describeSiblings visualization appears in warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [text] = createSignal("Cell");

    container.innerHTML = '<table _hk="0"><tbody><tr><td>Cell</td></tr></tbody></table>';

    dispose = hydrate(
      () => (
        <table>
          <tr>
            <td>{text()}</td>
          </tr>
        </table>
      ),
      container
    );

    const structureWarns = warn.mock.calls.filter(
      c => typeof c[0] === "string" && c[0].includes("Hydration structure mismatch")
    );
    expect(structureWarns.length).toBeGreaterThanOrEqual(1);
    const viz = structureWarns[0][2] as string;
    expect(viz).toContain("<table>");
    expect(viz).toContain("</table>");
    expect(viz).toContain("\u2190");
    warn.mockRestore();
  });
});
