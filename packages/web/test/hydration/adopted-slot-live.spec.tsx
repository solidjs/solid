/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The slot range of an adopted document boundary stays LIVE.
 *
 * A slot fill claims under the producer's hydration keys, and claiming runs
 * through `runWithOwner` — which clears `tracking` along with the owner. While
 * the claim wrapped insert's ACCESSOR, the binding's first read happened
 * inside that untracked window, so it only stayed reactive by accident:
 * when the read returned another accessor for insert to re-read, the
 * dependency got picked up on the re-read. When it did not — a `<Loading>`
 * answering a still-pending streamed fragment returns its fallback NODES —
 * the effect ended up with no dependency at all and the range never updated
 * again.
 *
 * In the notes example that reads as: the note the late fragment delivered is
 * on screen and correct, and every navigation OUT of it (New, Edit, home)
 * changes the URL and nothing else. The claim now wraps the insert CALL, so
 * the first evaluation is the render effect's own compute — still under the
 * producer's keys, but tracked.
 *
 * Lives in the hydrate config because that is where JSX compiles hydratable:
 * `claimRender` bails out entirely without `sharedConfig.getNextContextId`,
 * so the untracked window this pins never opens in the plain client config.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
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

const FID = "live/slot";

describe("adopted slot range", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any)._$HY;
    delete (globalThis as any)._$SC;
    document.body.innerHTML = "";
  });

  test("keeps updating when the claim's first read is not an accessor", async () => {
    // The document as the server left it: an SSR'd boundary whose children
    // slot is still showing a deferred fragment's fallback. The `pl-*`
    // placeholder in the range is what engages the claim scope for a fallback
    // with no claimable elements of its own (#2964).
    const container = document.createElement("div");
    container.innerHTML =
      `<dx-frame data-fid="${FID}" style="display:contents">` +
      "<article><!--slot:children:start-->" +
      '<template id="pl-4242"></template>waiting<!--pl-4242-->' +
      "<!--slot:children:end--></article>" +
      "</dx-frame>";
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });
    installServerComponents(makeHost());

    const [label, setLabel] = createSignal("waiting");
    const Feed = (globalThis as any)._$SC.r(FID);
    const dispose = hydrate(() => <Feed>{() => label()}</Feed>, container);
    flush();
    await settle();
    flush();

    const frame = container.querySelector(`dx-frame[data-fid="${FID}"]`)!;
    expect(frame.textContent).toContain("waiting");

    // Whatever the claim settled on, the source moving is what has to land.
    setLabel("revealed");
    flush();
    await settle();
    flush();

    expect(frame.textContent).toContain("revealed");
    expect(frame.textContent).not.toContain("waiting");

    dispose();
    container.remove();
  });
});
