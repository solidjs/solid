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
import { createRoot, enableHydration, flush, Loading } from "solid-js";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { createJSONDataTable } from "../serialization/src/index.js";
import { createServerReference } from "../src/server-functions/client.js";
import { createChunk } from "../src/server-functions/shared.js";

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

const FID = "late/feed";
// Distinct ids per test: a boundary is claimable exactly once per page.
const FID_HELD = "late/held";
const FID_EXHAUSTED = "late/exhausted";

/** A pending `<id>_fr` declaration as the serializer writes it: an unsettled
 *  promise ref — the ledger reads `.s` for settlement, never awaits it. */
function declareFragment(id: string) {
  (window as any)._$HY.r[`${id}_fr`] = { then() {} };
}

/** The `$df` swap, reduced to what matters here: retire the fragment's
 *  placeholder, put the server's boundary element in the live document,
 *  record the reveal in the ledger (`_$HY.v`, what the real $dfr marks;
 *  seroval settles the `_fr` ref in the same batch), then announce it. */
function swapIn(parent: HTMLElement, html: string) {
  document.getElementById("pl-1902")?.remove();
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  parent.appendChild(tpl.content);
  const hy = (window as any)._$HY;
  (hy.v = hy.v || {})["1902"] = 1;
  if (hy.r["1902_fr"]) hy.r["1902_fr"].s = 1;
  hy.fe && hy.fe("1902", parent);
}

/** A one-shot frame stream, the shape a navigation's response arrives in. */
function frameResponse(id: string, html: string) {
  const chunks = [
    { type: "start", id, version: 1 },
    { type: "html", id, version: 1, html },
    { type: "complete", id, version: 1 }
  ];
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(createChunk(JSON.stringify(c)));
      controller.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": id } });
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
    enableHydration();
    declareFragment("1902");
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

  // The same "not in the page yet" moment, one step later in the document's
  // life: global hydration has already completed. Under the held-swap policy
  // (#2964) that no longer means the page is finished — a fragment settling
  // post-done keeps its placeholder, fallback and template in place until its
  // boundary claims it, and the replay that follows is what delivers this
  // element. A boundary rendering in that window (a frames slot fill or lazy
  // route module running after the root pass) that reads `done` as "never"
  // mounts a fresh frame and orphans the markup: the region goes inert AND —
  // because the id is never claimed — every later call for this function
  // resolves back to the document placeholder instead of fetching, so the app
  // stops responding to navigation entirely.
  test("waits for a fragment still holding the element after hydration reports done", async () => {
    document.body.innerHTML =
      '<div id="app"><template id="pl-1902"></template>fallback<!--pl-1902--></div>';
    (window as any)._$HY = { r: {}, fe() {}, done: true };
    enableHydration();
    declareFragment("1902");
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called while awaiting the swap");
    });
    const host = makeHost();
    installServerComponents(host);

    const Feed = (window as any)._$SC.r(FID_HELD);
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

    expect(mount.querySelectorAll(`dx-frame[data-fid="${FID_HELD}"]`).length).toBe(0);

    swapIn(
      mount,
      `<dx-frame data-fid="${FID_HELD}" style="display:contents"><ul><li>server-item</li></ul></dx-frame>`
    );
    flush();
    await settle();
    flush();

    const frames = mount.querySelectorAll(`dx-frame[data-fid="${FID_HELD}"]`);
    expect(frames.length).toBe(1);
    expect((frames[0] as HTMLElement).textContent).toContain("server-item");

    // Claimed on adoption: the next call for this function is a navigation,
    // and it has to leave the browser. Resolving it locally with the document
    // placeholder again is what made every subsequent click a no-op.
    const feed = createServerReference(FID_HELD);
    let requests = 0;
    vi.stubGlobal("fetch", async () => {
      requests++;
      return frameResponse(FID_HELD, "<ul><li>navigated-item</li></ul>");
    });
    await feed(2);
    flush();
    await settle();
    flush();

    expect(requests).toBe(1);

    dispose();
  });

  // The mirror case: nothing is left to reveal, so waiting would strand the
  // region on its fallback forever. A reveal that exhausts the page's deferred
  // fragments releases the waiter to mount fresh.
  test("gives up waiting once the page has no deferred fragment left", async () => {
    document.body.innerHTML =
      '<div id="app"><template id="pl-1902"></template>fallback<!--pl-1902--></div>';
    (window as any)._$HY = { r: {}, fe() {}, done: true };
    enableHydration();
    declareFragment("1902");
    const host = makeHost();
    installServerComponents(host);

    const Feed = (window as any)._$SC.r(FID_EXHAUSTED);
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

    expect(mount.querySelectorAll(`dx-frame[data-fid="${FID_EXHAUSTED}"]`).length).toBe(0);

    // The fragment reveals — but it carried someone else's content, and it was
    // the last one the page had.
    swapIn(mount, "<span>unrelated</span>");
    flush();
    await settle();
    flush();

    // A client-owned frame for the id, ready to take the stream a call fills
    // it with — rather than a permanently pending boundary.
    expect(mount.querySelectorAll(`dx-frame[data-fid="${FID_EXHAUSTED}"]`).length).toBe(1);

    dispose();
  });
});
