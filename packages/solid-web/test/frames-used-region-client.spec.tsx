/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #547, facade half: ctx.adopted gates hydration claims to the adoption
// attach — a stream re-call must render for REAL, and {$frame} args
// resolved during it must mount and keep morphing. (The claim-in-place +
// no-re-call halves are pinned in the runtime suites: this vitest config
// doesn't compile hydratable JSX, so claimRender's registry path — which
// needs `_hk` on the adopted wrapper — can't engage here.)
// Own spec file: the boundary marker index is a once-per-boot module cache.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, flush, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import {
  installServerComponents,
  createFrameHost,
  createJSONDataTable
} from "../frames/src/client.js";
import { createServerReference } from "@dom-expressions/runtime/src/server-functions/client.js";

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

describe("adopted boundary stream re-calls (#547)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any)._$HY;
    document.body.innerHTML = "";
  });

  test("an identical re-sent record does not re-call; a changed record re-renders for real and its {$frame} region mounts and morphs", async () => {
    document.body.innerHTML =
      '<div id="app"><dx-frame data-fid="occ/used" style="display:contents">' +
      "<article><!--slot:comment#c1:start-->" +
      '<div class="comment"><button>[-]</button></div>' +
      "<!--slot:comment#c1:end--></article>" +
      "</dx-frame></div>";
    (window as any)._$HY = {
      r: { "sc:slot:occ/used:comment#c1": { cid: "c1" } }
    };
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    const host = makeHost();
    installServerComponents(host);

    const renders: any[] = [];
    const getThread = createServerReference("occ/used");
    const Thread = dynamic(() => getThread() as any);
    const appEl = document.getElementById("app")!;
    let mount!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={mount}>
        <Loading fallback={<span>...</span>}>
          <Thread
            comment={(p: any) => {
              renders.push(p.cid);
              return (
                <div class="comment fresh">
                  <button>[-]</button>
                  {p.children}
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

    // Adoption attach: armed with the drained t=0 record.
    expect(renders).toEqual(["c1"]);

    // A re-sent record with IDENTICAL args: no re-call.
    host.apply({
      type: "slot",
      id: "occ/used",
      version: 1,
      key: "comment#c1",
      args: { cid: "c1" }
    });
    flush();
    await settle();
    expect(renders).toEqual(["c1"]);

    // A GENUINE change re-renders for real — ctx.adopted no longer claims —
    // and the {$frame} arg resolves to a live region range in the output.
    host.apply({
      type: "slot",
      id: "occ/used",
      version: 2,
      key: "comment#c1",
      args: { cid: "c2", children: { $frame: "occ/used.comment#c1.children" } }
    });
    flush();
    await settle();
    flush();
    expect(renders).toEqual(["c1", "c2"]);
    expect(appEl.querySelector(".comment.fresh")).toBeTruthy();

    // The region streams content into the re-rendered wrapper and morphs.
    host.apply({
      type: "html",
      id: "occ/used.comment#c1.children",
      version: 1,
      html: "<em>streamed-body</em>"
    });
    flush();
    expect(appEl.querySelector("em")!.textContent).toBe("streamed-body");
    host.apply({
      type: "html",
      id: "occ/used.comment#c1.children",
      version: 2,
      html: "<em>streamed-body-2</em>"
    });
    flush();
    expect(appEl.querySelector("em")!.textContent).toBe("streamed-body-2");

    dispose();
  });
});
