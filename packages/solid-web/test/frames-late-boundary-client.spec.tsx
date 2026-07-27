/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// A server component whose source resolves AFTER the shell flush: the document
// hands the client its placeholder before the markup exists.
//
// The producer emits the resolution and the markup separately, in this order:
//
//   <script>$R[10]($R[8],$R[11]=self._$SC.r("late/feed"));</script>
//   <template id="1902">...<dx-frame data-fid="late/feed">...</dx-frame></template>
//   <script>$df("1902")</script>
//
// The resolver script runs FIRST — so the placeholder mounts, and
// documentBoundary is asked for a boundary whose element has not been parsed
// yet (on a live feed the shell flushes with a few hundred bytes of body).
// A synchronous "not found -> mount a fresh client frame" decision is
// unrecoverable: the server's markup lands later via the swap and is orphaned
// (visible but owned by nothing), while the stream drives an element that is
// not in the page. The user-visible result is a boundary that never updates
// again — every navigation fetches correctly and changes nothing.
//
// So a missing element must mean WAIT, not "render fresh": adopt when the swap
// delivers it, and stream into that same element afterwards.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, flush, Loading } from "solid-js";
import {
  installServerComponents,
  createFrameHost,
  createJSONDataTable
} from "../frames/src/client.js";

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

const FID = "late/feed";

/** The `$df` swap, reduced to what matters here: put the server's boundary
 *  element in the live document, then announce the reveal. */
function swapIn(parent: HTMLElement, html: string) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  parent.appendChild(tpl.content);
  const hy = (window as any)._$HY;
  hy.fe && hy.fe("1902", parent);
}

describe("boundary that arrives after the shell flush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any)._$HY;
    delete (window as any)._$SC;
    document.body.innerHTML = "";
  });

  test("adopts the swapped-in element, and later streams morph it", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    (window as any)._$HY = { r: {}, fe() {} };
    // The t=0 story is the document's; a boundary waiting for its element must
    // not go to the network to fill itself.
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called while awaiting the swap");
    });
    const host = makeHost();
    installServerComponents(host);

    // What the resolver script hands the client: the stable placeholder for
    // this function id, mounted while the document is still streaming.
    const Feed = (window as any)._$SC.r(FID);
    const appEl = document.getElementById("app") as HTMLElement;
    let mount!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={mount}>
        <Loading fallback={<span>fallback</span>}>
          <Feed />
        </Loading>
      </div>;
      appEl.appendChild(mount);
      return d;
    });
    flush();
    await settle();
    flush();

    // Nothing to adopt yet, so nothing may claim the id: a fresh client frame
    // here is the bug — it would take the stream the server's markup is owed.
    expect(mount.querySelectorAll(`dx-frame[data-fid="${FID}"]`).length).toBe(0);

    // The swap arrives.
    swapIn(
      mount,
      `<dx-frame data-fid="${FID}" style="display:contents"><ul><li>server-item</li></ul></dx-frame>`
    );
    flush();
    await settle();
    flush();

    const frames = mount.querySelectorAll(`dx-frame[data-fid="${FID}"]`);
    expect(frames.length).toBe(1);
    const frameEl = frames[0] as HTMLElement;
    expect(frameEl.textContent).toContain("server-item");

    // The adopted element is the one the boundary owns: a navigation's stream
    // must morph THIS element (policy A), not some detached twin.
    host.apply({
      type: "html",
      id: FID,
      version: 1,
      html: "<ul><li>navigated-item</li></ul>"
    } as any);
    flush();
    await settle();
    flush();

    expect(mount.querySelectorAll(`dx-frame[data-fid="${FID}"]`).length).toBe(1);
    expect(frameEl.textContent).toContain("navigated-item");
    expect(mount.textContent).not.toContain("server-item");

    dispose();
  });
});
