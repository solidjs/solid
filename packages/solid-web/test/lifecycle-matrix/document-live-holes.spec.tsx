/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Lifecycle matrix — T=0 DOCUMENT ADOPTION × LIVE MARKUP HOLES (Stage 4,
// client half). The page arrives with hole markers (`<!--lh:N-->…`) and
// attr addresses (`data-lha`) inside SSR'd boundaries, plus ONE `sc:live`
// hydration record whose value is a ReadableStream of ops. The pump runs
// once at module level and BROADCASTS: every adopted boundary applies every
// op into its own store, and page geometry routes (hole ids are
// document-unique; each frame's apply searches only its own range).
//
// Pinned here:
//   - a hole op morphs the adopted boundary's marked range in place;
//   - an attr op patches the addressed element;
//   - geometry routing: an op for boundary B applied through boundary A's
//     store stays pending in A and lands when B adopts (the catch-up
//     replay — ops that arrived before adoption apply right after it);
//   - a call-driven stream supersedes: after a version-1 apply, document
//     ops (version 0) go quiet.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createRoot, Loading } from "solid-js";
import { dynamic } from "../../src/index.js";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "@dom-expressions/runtime/src/server-functions/client.js";
import { makeHost, pump } from "./harness.js";

const getMorph = createServerReference("matrix/lh/morph");
const getAttr = createServerReference("matrix/lh/attr");
const getLate = createServerReference("matrix/lh/late");
const getStale = createServerReference("matrix/lh/stale");

function boundaryHtml(fid: string, inner: string) {
  return `<dx-frame data-fid="${fid}" style="display:contents"><article>${inner}</article></dx-frame>`;
}

let liveCtl!: ReadableStreamDefaultController<any>;

beforeAll(() => {
  document.body.innerHTML =
    '<div id="page">' +
    boundaryHtml("matrix/lh/morph", "<p><!--lh:0--><b>v1</b><!--lh:/0--></p>") +
    boundaryHtml("matrix/lh/attr", '<div data-lha="1" class="a" disabled="">x</div>') +
    boundaryHtml("matrix/lh/late", "<p><!--lh:2-->cold<!--lh:/2--></p>") +
    boundaryHtml("matrix/lh/stale", "<p><!--lh:3-->doc<!--lh:/3--></p>") +
    "</div>";
  (window as any)._$HY = {
    r: {
      "sc:live": new ReadableStream({
        start(c) {
          liveCtl = c;
        }
      })
    }
  };
});

afterAll(() => {
  delete (window as any)._$HY;
  document.body.innerHTML = "";
});

function mount(Comp: any) {
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

describe("t=0/live-holes", () => {
  test("a hole op morphs the adopted range in place; an attr op patches its addressed element", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called at t=0");
    });

    const mMorph = mount(dynamic(() => getMorph() as any));
    const mAttr = mount(dynamic(() => getAttr() as any));
    await pump();

    const morphEl = document.querySelector('[data-fid="matrix/lh/morph"]')! as HTMLElement;
    const p = morphEl.querySelector("p")!;
    expect(p.textContent).toBe("v1");

    liveCtl.enqueue({ type: "hole", key: "lh:0", html: "<b>v2</b>" });
    await pump();

    // Morphed in place: same <p> (the range's parent), new bold text.
    expect(morphEl.querySelector("p")).toBe(p);
    expect(p.textContent).toBe("v2");

    const attrEl = document.querySelector('[data-lha="1"]')! as HTMLElement;
    liveCtl.enqueue({ type: "attr", key: "1", attrs: ' class="b"', removed: ["disabled"] });
    await pump();
    expect(attrEl.getAttribute("class")).toBe("b");
    expect(attrEl.hasAttribute("disabled")).toBe(false);

    mMorph.cleanup();
    mAttr.cleanup();
  });

  test("catch-up: an op that arrived before its boundary adopted applies right after adoption", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called at t=0");
    });

    // The pump is already running (started by the earlier adoptions) and no
    // frame owns lh:2 yet — the op logs, broadcast finds no target.
    liveCtl.enqueue({ type: "hole", key: "lh:2", html: "warm" });
    await pump();
    const lateEl = document.querySelector('[data-fid="matrix/lh/late"]')! as HTMLElement;
    expect(lateEl.textContent).toBe("cold");

    const m = mount(dynamic(() => getLate() as any));
    await pump();

    // The adoption replayed the log over the claimed markup.
    expect(lateEl.textContent).toBe("warm");

    m.cleanup();
  });

  test("a call-driven stream supersedes: document ops go quiet after a version-1 apply", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });

    const m = mount(dynamic(() => getStale() as any));
    await pump();
    const el = document.querySelector('[data-fid="matrix/lh/stale"]')! as HTMLElement;
    expect(el.textContent).toBe("doc");

    // A navigation-shaped stream rebinds the boundary at version 1.
    host.apply({
      type: "html",
      id: "matrix/lh/stale",
      version: 1,
      html: "<article><p>stream</p></article>"
    });
    await pump(1);
    expect(el.textContent).toBe("stream");

    // A stale document op (version 0) must not touch the superseded content.
    liveCtl.enqueue({ type: "hole", key: "lh:3", html: "stale-doc" });
    await pump();
    expect(el.textContent).toBe("stream");

    m.cleanup();
  });
});
