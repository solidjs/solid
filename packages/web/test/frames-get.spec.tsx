/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Stage 8 B6 — `GET` server components end to end, the client half. A
// `GET(fn)` reference to a server component dispatches its call over GET at
// the data address with the arguments in the url — the url `serverFunctionUrl`
// renders, so a preload of it IS the call — and the frames handler claims the
// frame-stream answer like any other. Arguments too long for a url fall back
// to POST at the same address and the same frame stream comes back. A live
// reference has no url as a value (open decision (d)).
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import {
  GET,
  createServerReference,
  live,
  serverFunctionUrl
} from "../server-functions/src/client.js";
import { frameResponse, makeHost, pump } from "./lifecycle-matrix/harness.js";

const ID = "frames-get/panel";

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

/** Stub fetch answering every call with a one-shot frame stream saying `text`. */
function stubFrameFetch(text: string) {
  const calls: { url: string; init: any }[] = [];
  vi.stubGlobal("fetch", async (input: any, init: any) => {
    calls.push({ url: typeof input === "string" ? input : input.url, init });
    return frameResponse(ID, [
      { type: "start", id: ID, version: 1 },
      { type: "html", id: ID, version: 1, html: `<p class="panel">${text}</p>` },
      { type: "complete", id: ID, version: 1 }
    ]);
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("GET server components end to end (Stage 8 B6)", () => {
  test("the call goes over GET at the data address — the url serverFunctionUrl renders — and the frame stream mounts", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const calls = stubFrameFetch("hello ann");
    const getPanel = GET(createServerReference(ID));
    const Panel = dynamic(() => getPanel("ann") as any);
    const m = mountUnderLoading(Panel);
    await pump();
    expect(m.div.querySelector(".panel")!.textContent).toBe("hello ann");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].url).toBe("/_server/data/frames-get%2Fpanel?args=%5B%22ann%22%5D");
    // A preload of the rendered url is the call: same address, same query.
    expect(serverFunctionUrl(getPanel as any, "ann")).toBe(calls[0].url);
    m.cleanup();
  });

  test("arguments too long for a url fall back to POST at the data address; the same frame stream comes back", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const calls = stubFrameFetch("hello long");
    const getPanel = GET(createServerReference(ID));
    const name = "n".repeat(3000);
    // Two arguments: a lone string would ride as a text/plain body (the
    // transport's natural encoding); a list goes as JSON.
    const Panel = dynamic(() => getPanel(name, 1) as any);
    const m = mountUnderLoading(Panel);
    await pump();
    expect(m.div.querySelector(".panel")!.textContent).toBe("hello long");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/_server/data/frames-get%2Fpanel");
    expect(calls[0].init.method ?? "POST").toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual([name, 1]);
    // ...and no url describes that call.
    expect(() => serverFunctionUrl(getPanel as any, name, 1)).toThrow(/characters/);
    m.cleanup();
  });

  test("a live reference has no url as a value (open (d)): serverFunctionUrl refuses it", () => {
    const getPanel = GET(createServerReference(ID));
    const standing = live(getPanel);
    expect(() => serverFunctionUrl(standing as any, "ann")).toThrow(/live reference/);
    // The one-shot url is the inner declaration's.
    expect(serverFunctionUrl(getPanel as any, "ann")).toBe(
      "/_server/data/frames-get%2Fpanel?args=%5B%22ann%22%5D"
    );
  });
});
