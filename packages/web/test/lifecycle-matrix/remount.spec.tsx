/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Lifecycle matrix — mount kind: REMOUNT AFTER UNMOUNT (away/back), in three
// flavors: same args (warm resident store re-materializes while the refetch
// is in flight), changed args while away (the fresh mount must bind the
// LATEST call's address — the turnkey regression), and an adopted document
// boundary whose interior was captured at last-unmount.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, flush, Loading } from "solid-js";
import { dynamic } from "../../src/index.js";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../src/server-functions/client.js";
import { makeHost, frameResponse, openFrameResponse, pump } from "./harness.js";

const getSame = createServerReference("matrix/rm/same");
const getChanged = createServerReference("matrix/rm/changed");
const getAdopted = createServerReference("matrix/rm/adopted");

function storyChunks(id: string, title: string, comment = "c") {
  return [
    { type: "start", id, version: 1 },
    { type: "slot", id, version: 1, key: "comment#0", args: { text: comment } },
    {
      type: "html",
      id,
      version: 1,
      html: `<article><h1>${title}</h1><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul></article>`
    },
    { type: "complete", id, version: 1 }
  ];
}

beforeAll(() => {
  // The adopted-boundary cell's SSR'd markup must be in the document before
  // the FIRST boundary lookup of this module (once-per-boot index).
  document.body.innerHTML =
    '<div id="page"><dx-frame data-fid="matrix/rm/adopted" style="display:contents">' +
    "<article><h1>Adopted</h1></article>" +
    "</dx-frame></div>";
});

afterAll(() => {
  document.body.innerHTML = "";
});

afterEach(() => vi.unstubAllGlobals());

/** Mount/unmount toggle harness: `away()` unmounts the boundary, `back()` remounts. */
function mountToggle(Comp: any, props: Record<string, any> = {}) {
  const [show, setShow] = createSignal(true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      {show() ? (
        <Loading fallback={<span>shell-fallback</span>}>
          <Comp {...props} />
        </Loading>
      ) : (
        <p>away</p>
      )}
    </div>;
    container.appendChild(div);
    return d;
  });
  return {
    div,
    away: () => setShow(false),
    back: () => setShow(true),
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

describe("remount/same-args", () => {
  test("away/back re-materializes from the WARM resident store while the refetch is in flight; slot state was reset by the unmount; the refetch then morphs", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    const held = openFrameResponse("srv");
    vi.stubGlobal("fetch", async () => {
      call++;
      if (call === 1) return frameResponse("srv", storyChunks("srv", "First"));
      return held.response;
    });

    let mounts = 0;
    let bump!: () => void;
    const Page = dynamic(() => getSame() as any);
    const m = mountToggle(Page, {
      comment: (p: any) => {
        mounts++;
        const [n, setN] = createSignal(0);
        bump = () => setN(n() + 1);
        return (
          <li>
            {p.text}:{n()}
          </li>
        );
      }
    });
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("First");
    bump();
    flush();
    expect(m.div.querySelector("ul li")!.textContent).toBe("c:1");
    expect(mounts).toBe(1);

    m.away();
    flush();
    expect(m.div.querySelector("article")).toBe(null);
    expect(m.div.querySelector("p")!.textContent).toBe("away");

    // Back: the source re-runs (a fresh request leaves — held open here), and
    // the remounted boundary seeds from the RESIDENT STORE: the previous
    // content shows before a single byte of the refetch's body arrives.
    m.back();
    await pump();
    expect(call).toBe(2);
    expect(m.div.querySelector("h1")!.textContent).toBe("First");
    // The unmount RESET the occurrence: fresh invocation, fresh signal.
    expect(mounts).toBe(2);
    expect(m.div.querySelector("ul li")!.textContent).toBe("c:0");

    // The refetch completes and morphs the re-materialized content.
    for (const c of storyChunks("srv", "First-Refetched")) held.send(c);
    held.close();
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("First-Refetched");

    m.cleanup();
  });
});

describe("remount/changed-args", () => {
  test("args change WHILE AWAY: the remounted site binds the latest call's address, not the first resolution's", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const fetched: number[] = [];
    vi.stubGlobal("fetch", async (_base: any, init: any) => {
      const v = JSON.parse(String(init.body))[0];
      fetched.push(v);
      return frameResponse("srv", storyChunks("srv", `Story ${v}`));
    });

    const [story, setStory] = createSignal(1);
    const Page = dynamic(() => getChanged(story()) as any);
    const m = mountToggle(Page, { comment: (p: any) => <li>{p.text}</li> });
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("Story 1");

    // Navigate away, THEN the call's args change (a route param updating
    // while its view is unmounted): no live site receives the delivery.
    m.away();
    flush();
    setStory(2);
    flush();

    // Back: the fresh mount must initialize from the LATEST resolved
    // address — story 2's — not the kept binding's first-resolution address
    // (which would re-materialize story 1's resident store).
    m.back();
    await pump();
    expect(fetched).toEqual([1, 2]);
    expect(m.div.querySelector("h1")!.textContent).toBe("Story 2");

    m.cleanup();
  });
});

describe("remount/adopted-boundary", () => {
  test("away/back over a t=0 adopted boundary: the interior captured at unmount re-materializes instantly, and the refetch (now a real request) morphs it", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    // t=0: the document answers; the network must not be touched.
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called at t=0");
    });

    const Page = dynamic(() => getAdopted() as any);
    const m = mountToggle(Page, {});
    await pump();
    const ssrEl = document.querySelector('[data-fid="matrix/rm/adopted"]');
    expect(ssrEl).toBeTruthy();
    expect(m.div.querySelector("h1")!.textContent).toBe("Adopted");

    // Away: the adopted frame disposes; its interior — which never rode
    // chunks — is captured into the resident store at last-unmount.
    m.away();
    flush();
    expect(m.div.querySelector("article")).toBe(null);

    // Back: the boundary was CONSUMED on adoption, so this call leaves the
    // browser. While the response is held, the captured interior shows.
    const held = openFrameResponse("srv");
    let requests = 0;
    vi.stubGlobal("fetch", async () => {
      requests++;
      return held.response;
    });
    m.back();
    await pump();
    expect(requests).toBe(1);
    expect(m.div.querySelector("h1")!.textContent).toBe("Adopted");

    held.send({ type: "start", id: "srv", version: 1 });
    held.send({
      type: "html",
      id: "srv",
      version: 1,
      html: "<article><h1>Refetched</h1></article>"
    });
    held.send({ type: "complete", id: "srv", version: 1 });
    held.close();
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("Refetched");

    m.cleanup();
  });
});
