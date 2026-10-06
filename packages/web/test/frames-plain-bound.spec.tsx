/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The plain-response streaming bound, client half (frames savings pass §6
// decision 4). A `complete` carrying `bound` is a landing like any other
// `complete` — the frame settles, the covering boundary releases — and the
// store keeps `:bound` beside `:complete`, so a consumer can tell a cut-off
// from a settled value. In dev the cut-off is named once per response, with
// `live()` as the declared way past the bound.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import { createServerReference } from "../server-functions/src/client.js";
import { frameAddress } from "../server-functions/src/shared.js";
import { makeHost, frameResponse, pump } from "./lifecycle-matrix/harness.js";

const html = (text: string) => `<article><p>${text}</p></article>`;

function mountUnderLoading(Comp: any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>shell-fallback</span>}>
        <Comp />
      </Loading>
    </div>;
    container.appendChild(div);
    return d;
  });
  return {
    div,
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("plain-response bound — the client", () => {
  test("`complete.bound` lands the frame, stores `:bound` beside `:complete`, and dev names live() once", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "html", id: "srv", version: 1, html: html("v3") },
        { type: "complete", id: "srv", version: 1, bound: "yields" }
      ])
    );
    const getFeed = createServerReference("frames-bound/yields");
    const Page = dynamic(() => getFeed() as any);
    const m = mountUnderLoading(Page);
    await pump();

    // Landed: the content shows, the covering boundary released.
    expect(m.div.querySelector("p")!.textContent).toBe("v3");
    expect(m.div.textContent).not.toContain("shell-fallback");
    const frame: any = host.get(frameAddress("frames-bound/yields"));
    expect(frame.store[":complete"]).toBe(true);
    expect(frame.store[":bound"]).toBe("yields");
    expect(frame.error).toBeUndefined();
    // Named once, with the way past it.
    const named = warn.mock.calls.filter(c => String(c[0]).includes("bound"));
    expect(named).toHaveLength(1);
    expect(String(named[0][0])).toContain('complete.bound: "yields"');
    expect(String(named[0][0])).toContain("live(");
    m.cleanup();
  });

  test("a `complete` without `bound` stores no `:bound` and warns nothing", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "html", id: "srv", version: 1, html: html("settled") },
        { type: "complete", id: "srv", version: 1 }
      ])
    );
    const getFeed = createServerReference("frames-bound/settled");
    const Page = dynamic(() => getFeed() as any);
    const m = mountUnderLoading(Page);
    await pump();
    const frame: any = host.get(frameAddress("frames-bound/settled"));
    expect(frame.store[":complete"]).toBe(true);
    expect(":bound" in frame.store).toBe(false);
    expect(warn.mock.calls.filter(c => String(c[0]).includes("bound"))).toHaveLength(0);
    m.cleanup();
  });

  test("a time bound is stored as such", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "html", id: "srv", version: 1, html: html("t") },
        { type: "complete", id: "srv", version: 1, bound: "time" }
      ])
    );
    const getFeed = createServerReference("frames-bound/time");
    const Page = dynamic(() => getFeed() as any);
    const m = mountUnderLoading(Page);
    await pump();
    const frame: any = host.get(frameAddress("frames-bound/time"));
    expect(frame.store[":bound"]).toBe("time");
    m.cleanup();
  });
});
