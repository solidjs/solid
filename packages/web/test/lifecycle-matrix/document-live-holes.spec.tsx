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
import { createMemo, createRoot, Loading } from "solid-js";
import { dynamic } from "../../src/index.js";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import { makeHost, pump } from "./harness.js";

const getMorph = createServerReference("matrix/lh/morph");
const getAttr = createServerReference("matrix/lh/attr");
const getLate = createServerReference("matrix/lh/late");
const getStale = createServerReference("matrix/lh/stale");
const getArgs = createServerReference("matrix/lh/args");
const getArgs2 = createServerReference("matrix/lh/args2");

function boundaryHtml(fid: string, inner: string) {
  return `<solid-frame data-fid="${fid}" style="display:contents"><article>${inner}</article></solid-frame>`;
}

let liveCtl!: ReadableStreamDefaultController<any>;

beforeAll(() => {
  document.body.innerHTML =
    '<div id="page">' +
    boundaryHtml("matrix/lh/morph", "<p><!--lh:0--><b>v1</b><!--lh:/0--></p>") +
    boundaryHtml("matrix/lh/attr", '<div data-lha="1" class="a" disabled="">x</div>') +
    boundaryHtml("matrix/lh/late", "<p><!--lh:2-->cold<!--lh:/2--></p>") +
    boundaryHtml("matrix/lh/stale", "<p><!--lh:3-->doc<!--lh:/3--></p>") +
    boundaryHtml(
      "matrix/lh/args",
      "<ul><!--slot:status#s1:start--><!--slot:status#s1:end--></ul>"
    ) +
    boundaryHtml(
      "matrix/lh/args2",
      "<ul><!--slot:status#s1:start--><!--slot:status#s1:end--></ul>"
    ) +
    "</div>";
  (window as any)._$HY = {
    r: {
      "sc:live": new ReadableStream({
        start(c) {
          liveCtl = c;
        }
      }),
      "sc:slot:matrix/lh/args:status#s1": { text: "t1" },
      "sc:slot:matrix/lh/args2:status#s1": { text: "other" }
    }
  };
});

afterAll(() => {
  delete (window as any)._$HY;
  document.body.innerHTML = "";
});

function mount(Comp: any, props: Record<string, any> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>shell-fallback</span>}>
        <Comp {...props} />
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

  test("a channel slot op updates the owning occurrence live; the fid gate keeps it out of other boundaries (DR-2 case 1)", async () => {
    // The document arg ledger's consumer half: a re-emitted occurrence
    // record arrives as a fid-tagged `slot` op on sc:live. Unlike hole and
    // attr ops (geometry-routed by document-unique keys), slot ops are
    // store-keyed — two boundaries can share an occurrence name — so only
    // the boundary whose document id matches applies it.
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called at t=0");
    });

    let mounts = 0;
    const reads: string[] = [];
    const otherReads: string[] = [];
    const mA = mount(
      dynamic(() => getArgs() as any),
      {
        status: (p: any) => {
          mounts++;
          createMemo(() => reads.push(p.text));
          return <li class="arg-fill">{p.text}</li>;
        }
      }
    );
    const mB = mount(
      dynamic(() => getArgs2() as any),
      {
        status: (p: any) => {
          createMemo(() => otherReads.push(p.text));
          return <li>{p.text}</li>;
        }
      }
    );
    await pump();
    expect(reads).toEqual(["t1"]);
    expect(otherReads).toEqual(["other"]);
    const li = document.querySelector('[data-fid="matrix/lh/args"]')!.querySelector(".arg-fill")!;

    liveCtl.enqueue({
      type: "slot",
      fid: "matrix/lh/args",
      key: "status#s1",
      args: { text: "t2" }
    });
    await pump();

    // Live props update in place: same instance, same node, new value …
    expect(mounts).toBe(1);
    expect(reads).toEqual(["t1", "t2"]);
    expect(li.textContent).toBe("t2");
    // … and the same-named occurrence in the OTHER boundary never saw it.
    expect(otherReads).toEqual(["other"]);

    mA.cleanup();
    mB.cleanup();
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
