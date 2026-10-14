/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Adopting a document whose server content nests regions (server JSX passed
// to a client fill — a comment's replies inside its toggle) claims each link
// once. Every region binds a frame over its element and sweeps its interior
// at adoption; the enclosing frame's sweep already covered that interior, so
// before this fix a link at depth N was claimed N+1 times, and a consumer
// like the router re-resolved its URL on every one.
// Own spec file: the boundary marker index is a once-per-boot module cache.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createRoot, flush, Loading } from "solid-js";
import { dynamic, registerElementClaim } from "../src/index.js";
import { installServerComponents, createFrameHost } from "../frames/src/client.js";
import { prepareTier } from "../frames/src/frame-client.js";
import { createJSONDataTable } from "../serialization/src/serializer.js";
import { createServerReference } from "../server-functions/src/client.js";

const settle = () => new Promise(r => setTimeout(r));

beforeAll(() => prepareTier("regions"));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r)
  });
}

const comment = (user: string, inner = "") =>
  `<li class="comment"><a href="/users/${user}">${user}</a>${inner}</li>`;

const toggle = (key: string, body: string) =>
  `<!--slot:toggle#${key}:start-->` +
  `<div class="toggle open"><a>[-]</a></div><ul class="comment-children">` +
  `<solid-frame data-fid="occ/thread.toggle#${key}.replies" style="display:contents">` +
  body +
  `</solid-frame></ul><!--slot:toggle#${key}:end-->`;

describe("element claims at adoption of nested regions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any)._$HY;
    document.body.innerHTML = "";
  });

  test("each link in a nested region is claimed once", async () => {
    // Three levels: top -> c1's replies -> c2's replies.
    document.body.innerHTML =
      '<div id="app"><solid-frame data-fid="occ/thread" style="display:contents">' +
      '<ul class="comment-children">' +
      comment("top", toggle("c1", comment("mid", toggle("c2", comment("leaf"))))) +
      "</ul></solid-frame></div>";
    (window as any)._$HY = {
      r: {
        "sc:slot:occ/thread:toggle#c1": { replies: { $frame: "occ/thread.toggle#c1.replies" } },
        "sc:slot:occ/thread:toggle#c2": { replies: { $frame: "occ/thread.toggle#c2.replies" } }
      }
    };
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called at t=0");
    });
    const claims = new Map<string, number>();
    const unregister = registerElementClaim(el => {
      const href = el.getAttribute("href");
      if (href) claims.set(href, (claims.get(href) || 0) + 1);
    });
    installServerComponents(makeHost());

    const getThread = createServerReference("occ/thread");
    const Thread = dynamic(() => getThread() as any);
    const appEl = document.getElementById("app")!;
    let mount!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={mount}>
        <Loading fallback={<span>...</span>}>
          <Thread
            toggle={(p: any) => (
              <>
                <div class="toggle open">
                  <a>[-]</a>
                </div>
                <ul class="comment-children">{p.replies}</ul>
              </>
            )}
          />
        </Loading>
      </div>;
      appEl.appendChild(mount);
      return d;
    });
    for (let i = 0; i < 3; i++) {
      flush();
      await settle();
    }

    expect([...appEl.querySelectorAll("a[href]")].map(a => a.getAttribute("href"))).toEqual([
      "/users/top",
      "/users/mid",
      "/users/leaf"
    ]);
    expect(Object.fromEntries(claims)).toEqual({
      "/users/top": 1,
      "/users/mid": 1,
      "/users/leaf": 1
    });

    unregister();
    dispose();
  });
});
