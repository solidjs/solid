/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Case 3, client half: a document arrives with an OCCLUDED region — content
// a collapsed-by-default wrapper never rendered at SSR — shipped once as
// hydration records (sc:slot: args + sc:region: html) instead of markup.
// documentBoundary must drain those records into the host BEFORE binding
// the adopting frame, so the first slot sync claims WITH real args and the
// wrapper mounts the body from the frame store on expand — zero network.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, flush, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable } from "../serialization/src/index.js";
import { createServerReference } from "../src/server-functions/client.js";

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

const getThread = createServerReference("occ/thread");

describe("occlusion records at adoption", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any)._$HY;
    document.body.innerHTML = "";
  });

  test("adopt with records → collapsed claim with args → expand mounts from store, zero network", async () => {
    // The SSR'd document: boundary with a collapsed wrapper whose body was
    // never rendered (occluded), plus the records the producer flipped.
    document.body.innerHTML =
      '<div id="app"><dx-frame data-fid="occ/thread" style="display:contents">' +
      "<article><!--slot:comment#c1:start-->" +
      '<div class="comment collapsed"><button>[+]</button></div>' +
      "<!--slot:comment#c1:end--></article>" +
      "</dx-frame></div>";
    (window as any)._$HY = {
      r: {
        "sc:slot:occ/thread:comment#c1": {
          cid: "c1",
          children: { $frame: "occ/thread.comment#c1.children" }
        },
        // One sync record and the promise-valued (async-occluded) variant
        // exercise the same drain path.
        "sc:region:occ/thread.comment#c1.children": Promise.resolve("<p>occluded-body</p>")
      }
    };
    // No network, ever: the page and its records are the whole t=0 story.
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called at t=0");
    });
    installServerComponents(makeHost());

    let expand!: () => void;
    const seenArgs: any[] = [];
    const Thread = dynamic(() => getThread() as any);
    const appEl = document.getElementById("app")!;
    let mount!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={mount}>
        <Loading fallback={<span>...</span>}>
          <Thread
            comment={(p: any) => {
              seenArgs.push(p.cid);
              const [collapsed, setCollapsed] = createSignal(true);
              expand = () => setCollapsed(false);
              return (
                <div class={"comment" + (collapsed() ? " collapsed" : "")}>
                  <button>{collapsed() ? "[+]" : "[–]"}</button>
                  {!collapsed() && p.children}
                </div>
              );
            }}
          />
        </Loading>
      </div>;
      appEl.appendChild(mount);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    // Claimed collapsed: args arrived from the record, body absent.
    expect(seenArgs).toEqual(["c1"]);
    expect(appEl.textContent).not.toContain("occluded-body");

    // Expand: the body mounts from the frame store — no request possible.
    expand();
    flush();
    await settle();
    flush();
    expect(appEl.textContent).toContain("occluded-body");

    dispose();
  });
});
