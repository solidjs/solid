/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The zero-API client surface: `dynamic` + a server function IS the server
// component. Importing @solidjs/web/frames installs the transport policy —
// a frame-stream response resolves the call with a stable per-call-site
// component (owner-derived boundary identity), so dynamic's equals-gate
// never remounts across refetches; the response streams into the boundary
// underneath. The server side is mocked as hand-framed Responses behind a
// stubbed fetch, so the REAL server-function stub → transport → component
// pipeline is what's under test.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createMemo,
  createRoot,
  createSignal,
  flush,
  getOwner,
  Loading,
  onCleanup
} from "solid-js";
import { dynamic, registerElementClaim } from "../src/index.js";
import {
  installServerComponents,
  createFrameHost,
  createJSONDataTable
} from "../frames/src/client.js";
import { createServerReference } from "@dom-expressions/runtime/src/server-functions/client.js";
import { createChunk } from "@dom-expressions/runtime/src/server-functions/shared.js";

function frameResponse(id: string, chunks: any[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(createChunk(JSON.stringify(chunk)));
      controller.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": id } });
}

function storyResponse(version: number, title: string, comment = "first!") {
  return frameResponse("srv", [
    { type: "start", id: "srv", version },
    { type: "slot", id: "srv", version, key: "comment#0", args: { text: comment } },
    {
      type: "html",
      id: "srv",
      version,
      html:
        `<article><h1>${title}</h1>` +
        "<ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul>" +
        "<footer><!--slot:children:start--><!--slot:children:end--></footer>" +
        "</article>"
    },
    { type: "complete", id: "srv", version }
  ]);
}

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (ref: any) => table.resolve(ref)
  });
}

// One server function reference for the suite; each test isolates state by
// re-installing the policy against a fresh host and re-stubbing fetch.
const getStory = createServerReference("story/get");

describe("server components through dynamic", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => vi.unstubAllGlobals());

  test("mounts, fills slot ranges from props, morphs on re-fetch without remounting", async () => {
    const [story, setStory] = createSignal(1);
    const [tick, setTick] = createSignal(0);
    const fetched: number[] = [];
    // Like a real server, derive the response from the REQUEST body (the
    // codec-encoded args) — signals read inside a foreign async continuation
    // see 2.0's consistent snapshot, not the freshly written value.
    vi.stubGlobal("fetch", async (_base: any, init: any) => {
      const v = JSON.parse(String(init.body))[0];
      fetched.push(v);
      return storyResponse(v, `Story ${v}`);
    });

    let mounts = 0;
    const Story = dynamic(() => (tick(), getStory(story()) as any));

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <Story
            comment={(p: any) => {
              mounts++;
              return <li>{p.text}</li>;
            }}
          >
            <button>toggle</button>
          </Story>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    // Server content + both slot ranges in place.
    expect(div.querySelector("h1")!.textContent).toBe("Story 1");
    expect(div.querySelector("ul li")!.textContent).toBe("first!");
    const button = div.querySelector("footer button")!;
    expect(button.textContent).toBe("toggle");
    expect(fetched).toEqual([1]);
    expect(mounts).toBe(1);

    // Client-only state, then a SAME-args refetch: it resolves to the SAME
    // component reference — nothing remounts — while the new stream morphs
    // server content in the same boundary. Client node identity survives.
    (button as HTMLElement).dataset.on = "yes";
    const h1 = div.querySelector("h1");
    setTick(1);
    flush();
    await settle();
    flush();
    await settle();
    expect(fetched).toEqual([1, 1]);
    expect(div.querySelector("h1")).toBe(h1);
    expect(h1!.textContent).toBe("Story 1");
    expect(div.querySelector("footer button")).toBe(button);
    expect((button as HTMLElement).dataset.on).toBe("yes");
    // Equivalent re-sent slot args: the occurrence was not re-called.
    expect(mounts).toBe(1);

    // An ARGS change resolves a DIFFERENT component (per-args identity,
    // mirroring the query cache) — but this call site is LIVE, so dynamic
    // offers its previous value and the incoming component takes the mount:
    // the frame rebinds to the new call and story 2 morphs into the SAME
    // element. Client node identity and state survive the argument change
    // (the notes-search semantics), and equivalent slot args still don't
    // re-call the occurrence.
    setStory(2);
    flush();
    await settle();
    flush();
    await settle();
    expect(fetched).toEqual([1, 1, 2]);
    expect(div.querySelector("h1")).toBe(h1);
    expect(h1!.textContent).toBe("Story 2");
    expect(div.querySelector("footer button")).toBe(button);
    expect((button as HTMLElement).dataset.on).toBe("yes");
    expect(mounts).toBe(1);

    // Owner disposal tears the boundary down.
    dispose();
    flush();
    expect(div.querySelector("article")).toBe(null);
    container.remove();
  });

  test("an ARGS-CHANGE handoff whose stream carries changed slot args updates the live occurrence (notes-search shape)", async () => {
    // The notes sidebar search: the call's args change (searchText), the
    // call site is live so the boundary rebinds (handoff), AND the new
    // stream re-sends the occurrence's record with a changed arg value (the
    // server-baked href). The occurrence must update in place — state and
    // node identity survive — not re-call.
    const [story, setStory] = createSignal(1);
    vi.stubGlobal("fetch", async (_base: any, init: any) => {
      const v = JSON.parse(String(init.body))[0];
      return storyResponse(v, `Story ${v}`, `comment-${v}`);
    });

    let mounts = 0;
    const Story = dynamic(() => getStory(story()) as any);

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <Story
            comment={(p: any) => {
              mounts++;
              return <li>{p.text}</li>;
            }}
          >
            <button>toggle</button>
          </Story>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    const li = div.querySelector("ul li")! as HTMLElement;
    expect(li.textContent).toBe("comment-1");
    expect(mounts).toBe(1);
    li.dataset.keep = "yes";

    setStory(2);
    flush();
    await settle();
    flush();
    await settle();
    expect(div.querySelector("h1")!.textContent).toBe("Story 2");
    expect(mounts).toBe(1);
    expect(div.querySelector("ul li")).toBe(li);
    expect(li.textContent).toBe("comment-2");
    expect(li.dataset.keep).toBe("yes");

    dispose();
    flush();
    container.remove();
  });

  test("a re-sent slot record with CHANGED args updates the live occurrence in place (no re-call)", async () => {
    // The entity-identity promise: when a morph re-sends an occurrence's
    // record with different arg VALUES (a renamed note, a search-dependent
    // href), the mounted instance receives the new props reactively — it is
    // NOT re-called, so its client state and DOM identity survive and
    // effects over the changed prop fire.
    const [tick, setTick] = createSignal(0);
    const comments = ["first!", "edited!"];
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      const v = ++call;
      return storyResponse(v, "Story 1", comments[v - 1]);
    });

    let mounts = 0;
    const seen: string[] = [];
    const Story = dynamic(() => (tick(), getStory(1) as any));

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <Story
            comment={(p: any) => {
              mounts++;
              createMemo(() => seen.push(p.text));
              return <li>{p.text}</li>;
            }}
          >
            <button>toggle</button>
          </Story>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    const li = div.querySelector("ul li")! as HTMLElement;
    expect(li.textContent).toBe("first!");
    expect(mounts).toBe(1);
    // Client-only state on the occurrence's own DOM.
    li.dataset.keep = "yes";

    // Same-args refetch; the new stream re-sends the record with a CHANGED
    // arg value. The occurrence updates in place: same invocation, same
    // node, new text — and the reactive read saw the change.
    setTick(1);
    flush();
    await settle();
    flush();
    await settle();
    expect(mounts).toBe(1);
    expect(div.querySelector("ul li")).toBe(li);
    expect(li.textContent).toBe("edited!");
    expect(li.dataset.keep).toBe("yes");
    expect(seen).toEqual(["first!", "edited!"]);

    dispose();
    flush();
    container.remove();
  });

  test("covers an unboundaried async client fill revealed in a deferred segment (no orphan)", async () => {
    // The #1 case: a deferred segment reveals content containing a client fill
    // that is async and has NO <Loading> of its own. The reveal reconstructs a
    // client <Loading> at the segment's placeholder seam, so the fill's
    // NotReadyError propagates up to THAT boundary — the segment's server
    // fallback holds until the fill settles, instead of flashing empty on the
    // frame's already-latched outer boundary.
    let resolveComment!: (v: string) => void;
    const commentReady = new Promise<string>(r => (resolveComment = r));

    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: {} },
        {
          type: "html",
          id: "srv",
          version: 1,
          html: '<article><template id="pl-c"><span>seg-loading</span></template><!--pl-c--></article>'
        },
        {
          type: "fragment",
          id: "srv",
          version: 1,
          key: "c",
          html: "<div><!--slot:comment#0:start--><!--slot:comment#0:end--></div>"
        },
        { type: "reveal", id: "srv", version: 1, keys: ["c"], waitForStyles: false },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    const Story = dynamic(() => getStory(1) as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>outer</span>}>
          <Story
            comment={() => {
              // Async fill, NO local <Loading>: reads a pending async source.
              const text = createMemo(() => commentReady);
              return <b>{text()}</b>;
            }}
          />
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    // The segment revealed, but its async fill is pending: the reconstructed
    // boundary holds the SEGMENT fallback — not empty, not the outer fallback.
    expect(div.querySelector("template#pl-c")).toBe(null); // placeholder consumed
    expect(div.textContent).toContain("seg-loading"); // segment fallback held
    expect(div.textContent).not.toContain("outer"); // outer already resolved
    expect(div.querySelector("b")).toBe(null); // fill not shown yet

    // The fill settles -> the boundary reveals the content.
    resolveComment("hello");
    flush();
    await settle();
    flush();
    await settle();
    expect(div.textContent).not.toContain("seg-loading");
    expect(div.querySelector("b")!.textContent).toBe("hello");

    dispose();
    container.remove();
  });

  test("two dynamic() sources over one server function get independent boundaries", async () => {
    const queue = [storyResponse(1, "Left"), storyResponse(1, "Right")];
    vi.stubGlobal("fetch", async () => queue.shift()!);

    const Left = dynamic(() => getStory(1) as any);
    const Right = dynamic(() => getStory(2) as any);

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <section id="l">
            <Left comment={(p: any) => <li>{p.text}</li>} />
          </section>
          <section id="r">
            <Right comment={(p: any) => <li>{p.text}</li>} />
          </section>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    // Same function, two call sites: two boundaries, nothing declared.
    expect(div.querySelector("#l h1")!.textContent).toBe("Left");
    expect(div.querySelector("#r h1")!.textContent).toBe("Right");

    dispose();
    container.remove();
  });

  test("one server component mounted twice fans the stream out to both instances", async () => {
    const [v, setV] = createSignal(1);
    vi.stubGlobal("fetch", async (_base: any, init: any) => {
      const n = JSON.parse(String(init.body))[0];
      return storyResponse(n, `Story ${n}`);
    });

    const Story = dynamic(() => getStory(v()) as any);

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <section id="a">
            <Story comment={(p: any) => <li>a:{p.text}</li>} />
          </section>
          <section id="b">
            <Story comment={(p: any) => <li>b:{p.text}</li>} />
          </section>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    // One logical stream, two boundary instances, each with its own slots.
    expect(div.querySelector("#a h1")!.textContent).toBe("Story 1");
    expect(div.querySelector("#b h1")!.textContent).toBe("Story 1");
    expect(div.querySelector("#a li")!.textContent).toBe("a:first!");
    expect(div.querySelector("#b li")!.textContent).toBe("b:first!");

    // A refetch morphs both instances.
    setV(2);
    flush();
    await settle();
    flush();
    await settle();
    expect(div.querySelector("#a h1")!.textContent).toBe("Story 2");
    expect(div.querySelector("#b h1")!.textContent).toBe("Story 2");

    dispose();
    container.remove();
  });

  test("ownerless calls resolve by call address: same args stable, different args independent", async () => {
    vi.stubGlobal("fetch", async () => storyResponse(1, "Solo"));
    // Same (function, arguments): the refetch resolves to the identical
    // component, so equals-gates hold and mounted content morphs in place.
    const first = await (getStory(1) as any);
    const again = await (getStory(1) as any);
    expect(typeof first).toBe("function");
    expect(again).toBe(first);
    // Different arguments are a different call: an ownerless preload for
    // other args must NOT collapse onto the boundary showing this one (a
    // hover preload would morph what the page is showing).
    const other = await (getStory(2) as any);
    expect(other).not.toBe(first);
  });

  test("preloading the args a mounted site navigated away from does not morph its boundary", async () => {
    // The notes-app hover bug, second form: view note 1, navigate to note 2
    // (the SAME dynamic source switches args, morphing its boundary in
    // place), then hover note 1 again. The boundary's showing-record for
    // args 1 must have been retired by the switch — a stale record routed
    // the hover preload's stream back into the mounted boundary, replacing
    // the note 2 the page was showing.
    const [story, setStory] = createSignal(1);
    vi.stubGlobal("fetch", async (_base: any, init: any) => {
      const v = JSON.parse(String(init.body))[0];
      return storyResponse(v, `Story ${v}`);
    });
    const Story = dynamic(() => getStory(story()) as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <Story comment={(p: any) => <li>{p.text}</li>} />
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();
    expect(div.querySelector("h1")!.textContent).toBe("Story 1");

    // Navigate: same call site, new args — morphs in place.
    setStory(2);
    flush();
    await settle();
    flush();
    await settle();
    expect(div.querySelector("h1")!.textContent).toBe("Story 2");

    // Hover preload for the note just left: ownerless, args 1. It mints its
    // own (offscreen) boundary; the mounted one keeps showing Story 2.
    const preloaded = await (getStory(1) as any);
    flush();
    await settle();
    flush();
    await settle();
    expect(typeof preloaded).toBe("function");
    expect(div.querySelector("h1")!.textContent).toBe("Story 2");

    dispose();
    container.remove();
  });

  test("props the server never placed stay unmounted; unknown occurrences without props stay empty", async () => {
    vi.stubGlobal("fetch", async () => storyResponse(1, "Solo"));
    const Story = dynamic(() => getStory(1) as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      // No `comment` prop: the server's comment#0 range stays empty. The
      // extra `sidebar` prop has no server position: never invoked.
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <Story sidebar={() => <aside>never</aside>}>
            <button>b</button>
          </Story>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();
    expect(div.querySelector("h1")!.textContent).toBe("Solo");
    expect(div.querySelector("ul")!.textContent).toBe("");
    expect(div.querySelector("aside")).toBe(null);
    expect(div.querySelector("footer button")!.textContent).toBe("b");
    dispose();
    container.remove();
  });
});

describe("element claims (router link-state contract)", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => vi.unstubAllGlobals());

  // The consumer half is a router's link-state layer: it claims each
  // navigation-relevant element and scopes per-element state with onCleanup
  // of the claim-time owner. Frame content materializes from stream
  // continuations that have NO owner of their own — ownerScope (threaded by
  // boundaryComponent) is what hands these claims the boundary's owner, so
  // entries dispose with the boundary.
  test("streamed SC anchors claim under the boundary owner; disposal runs consumer cleanup", async () => {
    const claimed: string[] = [];
    const cleaned: string[] = [];
    const ownered: boolean[] = [];
    const unregister = registerElementClaim(el => {
      const href = el.getAttribute("href");
      if (!href) return;
      claimed.push(href);
      ownered.push(getOwner() !== null);
      onCleanup(() => cleaned.push(href));
    });
    vi.stubGlobal("fetch", async () =>
      frameResponse("nav", [
        { type: "start", id: "nav", version: 1 },
        {
          type: "html",
          id: "nav",
          version: 1,
          html: '<nav><a href="/top">top</a><a href="/new">new</a></nav>'
        },
        { type: "complete", id: "nav", version: 1 }
      ])
    );
    const getNav = createServerReference("nav/claims");
    const Nav = dynamic(() => getNav() as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = createRoot(d => {
      const div = (
        <div>
          <Loading fallback={<span>...</span>}>
            <Nav />
          </Loading>
        </div>
      ) as unknown as HTMLDivElement;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();
    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(claimed).toEqual(["/top", "/new"]);
    // Claim-time owner present even though the stream applied ownerless.
    expect(ownered).toEqual([true, true]);
    expect(cleaned).toEqual([]);
    dispose();
    flush();
    expect(cleaned.sort()).toEqual(["/new", "/top"]);
    unregister();
    container.remove();
  });
});
