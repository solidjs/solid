/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Document-face fallback residue (chat example, 2026-08-10): a slot fill
 * whose async arg settled ON THE SERVER before the document closed leaves
 * the region's markup showing the settled content — the server's inline
 * swap already replaced the fallback. When the client hydrates, the arg is
 * still pending LOCALLY for a beat (the record's settle applies just after
 * the first render), so the fill's <Loading> renders its fallback — fresh
 * nodes, because the server markup no longer carries the fallback to claim.
 * When the arg settles, the boundary switches to content and claims the
 * server's nodes… and the client-created fallback nodes must be REMOVED,
 * not left sitting beside the content.
 *
 * Observed live: the status row showed the ticker (client-created fallback,
 * no _hk) AND the settled stats side by side.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { flush, Loading } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents, createFrameHost } from "../../frames/src/client.js";
import { createJSONDataTable } from "../../serialization/src/index.js";

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

describe("adopted slot fill whose arg settled server-side before flush", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (globalThis as any)._$HY;
    delete (globalThis as any)._$SC;
    document.body.innerHTML = "";
  });

  test("plain fallback: no residue once the arg settles client-side", async () => {
    const FID = "residue/plain";
    const container = document.createElement("div");
    // The server swapped fallback -> content before the document closed:
    // the region's markup is the CONTENT only, keyed under the producer's
    // hydration chain exactly as the inline swap leaves it.
    container.innerHTML =
      `<dx-frame data-fid="${FID}" style="display:contents">` +
      "<div><!--slot:status#0:start-->" +
      `<span _hk="sc-residue/plain-status#0-2000" class="done"><!--$-->92<!--/--> tokens</span>` +
      "<!--slot:status#0:end--></div>" +
      "</dx-frame>";
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    installServerComponents(makeHost());

    // The arg record is present at adoption (rode the document), but the
    // promise has NOT settled client-side yet.
    let resolveStats!: (v: any) => void;
    const stats = new Promise(r => (resolveStats = r));
    (globalThis as any)._$HY.r[`sc:slot:${FID}:status#0`] = { stats };

    const Comp = (globalThis as any)._$SC.r(FID);
    const dispose = hydrate(
      () => (
        <Comp
          status={(p: any) => (
            <Loading fallback={<span class="ticker">…</span>}>
              <span class="done">{p.stats.tokens} tokens</span>
            </Loading>
          )}
        />
      ),
      container
    );
    flush();
    await settle();
    flush();
    // While the arg is pending locally, the server's settled markup stays —
    // no fallback flash over an adopted range.
    expect(container.querySelectorAll(".ticker").length).toBe(0);

    resolveStats({ tokens: 92 });
    await settle();
    flush();
    await settle();
    flush();

    expect(container.querySelectorAll(".done").length).toBe(1);
    expect(container.querySelectorAll(".ticker").length).toBe(0);
    expect(container.textContent).toContain("92 tokens");

    dispose();
    container.remove();
  });

  test("nested Loading in the fallback (the chat Status shape): no residue", async () => {
    const FID = "residue/nested";
    const container = document.createElement("div");
    container.innerHTML =
      `<dx-frame data-fid="${FID}" style="display:contents">` +
      "<div><!--slot:status#0:start-->" +
      `<span _hk="sc-residue/nested-status#0-2000" class="done"><!--$-->92<!--/--> tokens</span>` +
      "<!--slot:status#0:end--></div>" +
      "</dx-frame>";
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    installServerComponents(makeHost());

    let resolveStats!: (v: any) => void;
    const stats = new Promise(r => (resolveStats = r));
    // progress: an async iterable that has yielded (so the nested Loading
    // shows the ticker, not its own dots) and never ends — like a ticker
    // stream mid-generation.
    const progress = (async function* () {
      yield "thinking…";
      await new Promise(() => {});
    })();
    (globalThis as any)._$HY.r[`sc:slot:${FID}:status#0`] = { stats, progress };

    const Comp = (globalThis as any)._$SC.r(FID);
    const dispose = hydrate(
      () => (
        <Comp
          status={(p: any) => (
            <Loading
              fallback={
                <Loading fallback={<span class="ticker">…</span>}>
                  <span class="ticker">{p.progress}</span>
                </Loading>
              }
            >
              <span class="done">{p.stats.tokens} tokens</span>
            </Loading>
          )}
        />
      ),
      container
    );
    flush();
    await settle();
    flush();

    resolveStats({ tokens: 92 });
    await settle();
    flush();
    await settle();
    flush();

    expect(container.querySelectorAll(".done").length).toBe(1);
    expect(container.querySelectorAll(".ticker").length).toBe(0);
    expect(container.textContent).toContain("92 tokens");

    dispose();
    container.remove();
  });
});
