/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Lifecycle matrix — mount kind: FRESH CALL-DRIVEN MOUNT, crossed with the
// SLOT OCCURRENCE, CLIENT STATE SURVIVAL and CLEANUP/DISPOSAL dimensions.
// The "re-call path" cells use a consumer-constructed raw frame
// (createFrameElement): through solid-web's slotsFor every invoked
// occurrence registers live props (ctx.onUpdate), so the frame-level
// re-call path is unreachable from dynamic() by construction — see
// MATRIX.md.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, createSignal, flush, Loading, onCleanup } from "solid-js";
import { dynamic } from "../../src/index.js";
import { installServerComponents, createFrameElement } from "../../frames/src/client.js";
import { createServerReference } from "@dom-expressions/runtime/src/server-functions/client.js";
import { makeHost, frameResponse, pump } from "./harness.js";

const getDirect = createServerReference("matrix/slot/direct");
const getStatic = createServerReference("matrix/slot/static");
const getLive = createServerReference("matrix/slot/live");
const getDedupe = createServerReference("matrix/slot/dedupe");
const getKeyed = createServerReference("matrix/slot/keyed");
const getRemoved = createServerReference("matrix/slot/removed");
const getGauntlet = createServerReference("matrix/slot/gauntlet");
const getDisposal = createServerReference("matrix/slot/disposal");
const getLate = createServerReference("matrix/slot/late");

function storyChunks(id: string, comment = "first!") {
  return [
    { type: "start", id, version: 1 },
    { type: "slot", id, version: 1, key: "comment#0", args: { text: comment } },
    {
      type: "html",
      id,
      version: 1,
      html:
        "<article><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul>" +
        "<footer><!--slot:children:start--><!--slot:children:end--></footer></article>"
    },
    { type: "complete", id, version: 1 }
  ];
}

function mountUnderLoading(Comp: any, props: Record<string, any> = {}, children?: any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>shell-fallback</span>}>
        <Comp {...props}>{children}</Comp>
      </Loading>
    </div>;
    container.appendChild(div);
    return d;
  });
  return {
    div,
    dispose,
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("call-driven/slot/direct-insert", () => {
  test("JSX children fill their direct-insert range; props with no server position never render", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () => frameResponse("srv", storyChunks("srv")));

    const Page = dynamic(() => getDirect() as any);
    const m = mountUnderLoading(
      Page,
      { sidebar: () => <aside>never-placed</aside> },
      <button>toggle</button>
    );
    await pump();

    expect(m.div.querySelector("footer button")!.textContent).toBe("toggle");
    // `sidebar` has no marker in the server content: never invoked.
    expect(m.div.querySelector("aside")).toBe(null);
    // `comment#0` has a record but no client fill: its range stays empty.
    expect(m.div.querySelector("ul")!.textContent).toBe("");

    m.cleanup();
  });
});

describe("call-driven/slot/static-scalar-args", () => {
  test("a render-prop occurrence is invoked exactly once with its record's scalar args", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () => frameResponse("srv", storyChunks("srv", "scalar-args")));

    let mounts = 0;
    const seenArgs: any[] = [];
    const Page = dynamic(() => getStatic() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        mounts++;
        seenArgs.push(p.text);
        return <li>{p.text}</li>;
      }
    });
    await pump();

    expect(mounts).toBe(1);
    expect(seenArgs).toEqual(["scalar-args"]);
    expect(m.div.querySelector("ul li")!.textContent).toBe("scalar-args");

    m.cleanup();
  });
});

describe("call-driven/slot/args-change-live-props", () => {
  test("a re-sent record with CHANGED args updates the live occurrence in place: no re-call, signal state and node identity survive, effects fire", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () => frameResponse("srv", storyChunks("srv", "v1-text")));

    let mounts = 0;
    let bump!: () => void;
    const seen: string[] = [];
    const Page = dynamic(() => getLive() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        mounts++;
        const [n, setN] = createSignal(0);
        bump = () => setN(n() + 1);
        createMemo(() => seen.push(p.text));
        return (
          <li>
            {p.text}:{n()}
          </li>
        );
      }
    });
    await pump();
    const li = m.div.querySelector("ul li")! as HTMLElement;
    expect(li.textContent).toBe("v1-text:0");
    bump();
    flush();
    expect(li.textContent).toBe("v1-text:1");

    // The next response re-sends the occurrence's record with a changed arg.
    host.apply({
      type: "slot",
      id: "matrix/slot/live",
      version: 2,
      key: "comment#0",
      args: { text: "v2-text" }
    });
    await pump(1);

    expect(mounts).toBe(1); // not re-called
    expect(m.div.querySelector("ul li")).toBe(li); // node identity survives
    expect(li.textContent).toBe("v2-text:1"); // new props, old client state
    expect(seen).toEqual(["v1-text", "v2-text"]); // reactive read saw the change

    m.cleanup();
  });
});

describe("call-driven/slot/re-sent-identical-record", () => {
  test("an equivalent re-sent record dedupes: no re-call, no state loss", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () => frameResponse("srv", storyChunks("srv", "same")));

    let mounts = 0;
    let bump!: () => void;
    const Page = dynamic(() => getDedupe() as any);
    const m = mountUnderLoading(Page, {
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
    bump();
    flush();
    const li = m.div.querySelector("ul li")! as HTMLElement;
    expect(li.textContent).toBe("same:1");

    // Streams re-send their slot chunks: identical args, newer version.
    host.apply({
      type: "slot",
      id: "matrix/slot/dedupe",
      version: 2,
      key: "comment#0",
      args: { text: "same" }
    });
    await pump(1);

    expect(mounts).toBe(1);
    expect(m.div.querySelector("ul li")).toBe(li);
    expect(li.textContent).toBe("same:1");

    m.cleanup();
  });
});

describe("call-driven/slot/keyed-reorder", () => {
  test("$key: occurrence state follows the key across a reordering morph, not the position", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    // Two keyed occurrences (the producer names ranges by $key: item#a, item#b).
    const htmlFor = (order: string[]) =>
      "<ul>" +
      order.map(k => `<li><!--slot:item#${k}:start--><!--slot:item#${k}:end--></li>`).join("") +
      "</ul>";
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "slot", id: "srv", version: 1, key: "item#a", args: { id: "a" } },
        { type: "slot", id: "srv", version: 1, key: "item#b", args: { id: "b" } },
        { type: "html", id: "srv", version: 1, html: htmlFor(["a", "b"]) },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    let mounts = 0;
    const bumps: Record<string, () => void> = {};
    const Page = dynamic(() => getKeyed() as any);
    const m = mountUnderLoading(Page, {
      item: (p: any) => {
        mounts++;
        const [n, setN] = createSignal(0);
        bumps[p.id] = () => setN(n() + 1);
        return (
          <span>
            {p.id}:{n()}
          </span>
        );
      }
    });
    await pump();
    expect(mounts).toBe(2);
    const spanA = m.div.querySelectorAll("span")[0] as HTMLElement;
    expect(spanA.textContent).toBe("a:0");
    bumps.a();
    flush();
    expect(spanA.textContent).toBe("a:1");

    // The refetch reorders the keyed occurrences: b first, a second. The
    // records re-send identically (dedupe), and the ranges RELOCATE.
    const addr = "matrix/slot/keyed";
    host.apply({ type: "slot", id: addr, version: 2, key: "item#a", args: { id: "a" } });
    host.apply({ type: "slot", id: addr, version: 2, key: "item#b", args: { id: "b" } });
    host.apply({ type: "html", id: addr, version: 2, html: htmlFor(["b", "a"]) });
    await pump(1);

    expect(mounts).toBe(2); // nothing re-called
    const spans = m.div.querySelectorAll("span");
    expect(spans[0].textContent).toBe("b:0"); // b moved first
    expect(spans[1]).toBe(spanA); // a's LIVE node relocated
    expect(spans[1].textContent).toBe("a:1"); // …with its state

    m.cleanup();
  });
});

describe("call-driven/slot/occurrence-removed", () => {
  // GAP (cleanup half): a slot fill's solid `onCleanup` registers against the
  // BOUNDARY owner (slot invocations run under ownerScope), and occurrence
  // unmount only runs the frame's ctx-level cleanups — solid-web's slotsFor
  // registers a ctx cleanup only for reactive-content bindings. So when a
  // later response drops an occurrence, its fill's onCleanup does NOT fire
  // (it fires later, at boundary dispose). Expected: occurrence unmount
  // disposes the fill's reactive scope — its onCleanup runs right there.
  test.fails(
    "an occurrence dropped by a later response unmounts AND runs the fill's onCleanup",
    async () => {
      const { host } = makeHost();
      installServerComponents(host);
      vi.stubGlobal("fetch", async () => frameResponse("srv", storyChunks("srv", "doomed")));

      const cleaned: string[] = [];
      const Page = dynamic(() => getRemoved() as any);
      const m = mountUnderLoading(Page, {
        comment: (p: any) => {
          onCleanup(() => cleaned.push(p.text));
          return <li>{p.text}</li>;
        }
      });
      await pump();
      expect(m.div.querySelector("ul li")!.textContent).toBe("doomed");

      // The next response's content no longer places comment#0.
      host.apply({
        type: "html",
        id: "matrix/slot/removed",
        version: 2,
        html: "<article><ul></ul><footer><!--slot:children:start--><!--slot:children:end--></footer></article>"
      });
      await pump(1);

      expect(m.div.querySelector("ul li")).toBe(null); // unmounted
      expect(cleaned).toEqual(["doomed"]); // GAP: stays [] until boundary dispose

      m.cleanup();
    }
  );

  test("a removed occurrence's DOM unmounts; re-introducing the occurrence re-invokes fresh (state reset)", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () => frameResponse("srv", storyChunks("srv", "one")));

    let mounts = 0;
    let bump!: () => void;
    const Page = dynamic(() => getGauntlet() as any);
    const m = mountUnderLoading(Page, {
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
    bump();
    flush();
    expect(m.div.querySelector("ul li")!.textContent).toBe("one:1");
    expect(mounts).toBe(1);

    const addr = "matrix/slot/gauntlet";
    // v2 drops the occurrence entirely.
    host.apply({
      type: "html",
      id: addr,
      version: 2,
      html: "<article><ul></ul><footer><!--slot:children:start--><!--slot:children:end--></footer></article>"
    });
    await pump(1);
    expect(m.div.querySelector("ul li")).toBe(null);

    // v3 re-introduces it (same occurrence name, fresh record): the fill is
    // re-invoked — occurrence unmount RESET its state.
    host.apply({ type: "slot", id: addr, version: 3, key: "comment#0", args: { text: "two" } });
    host.apply({
      type: "html",
      id: addr,
      version: 3,
      html:
        "<article><ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul>" +
        "<footer><!--slot:children:start--><!--slot:children:end--></footer></article>"
    });
    await pump(1);
    expect(mounts).toBe(2);
    expect(m.div.querySelector("ul li")!.textContent).toBe("two:0");

    m.cleanup();
  });
});

describe("call-driven/cleanup-disposal", () => {
  test("boundary dispose runs slot fills' onCleanup exactly once, and tears the boundary down", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () => frameResponse("srv", storyChunks("srv", "c")));

    const cleaned: string[] = [];
    const Page = dynamic(() => getDisposal() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        onCleanup(() => cleaned.push("fill"));
        return <li>{p.text}</li>;
      }
    });
    await pump();
    expect(m.div.querySelector("ul li")!.textContent).toBe("c");
    expect(cleaned).toEqual([]);

    m.dispose();
    flush();
    expect(cleaned).toEqual(["fill"]);
    expect(m.div.querySelector("article")).toBe(null);

    // No double-dispose: a second disposal of the same owner is a no-op.
    m.dispose();
    flush();
    expect(cleaned).toEqual(["fill"]);

    m.cleanup();
  });

  test("a disposed frame ignores late chunks (no DOM writes, no crash)", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () => frameResponse("srv", storyChunks("srv", "gone")));

    const Page = dynamic(() => getLate() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => <li>{p.text}</li>
    });
    await pump();
    expect(m.div.querySelector("ul li")!.textContent).toBe("gone");

    m.dispose();
    flush();
    expect(m.div.querySelector("article")).toBe(null);
    // Dispose unregistered the frame from the host.
    expect(host.get("matrix/slot/late")).toBeUndefined();

    // Late chunks for the disposed boundary: they warm the resident store
    // (that's the retention model) but touch no DOM and throw nothing.
    host.apply({
      type: "html",
      id: "matrix/slot/late",
      version: 2,
      html: "<article><h1>Zombie</h1></article>"
    });
    host.apply({
      type: "slot",
      id: "matrix/slot/late",
      version: 2,
      key: "comment#0",
      args: { text: "zombie" }
    });
    await pump(1);
    expect(document.body.textContent).not.toContain("Zombie");

    m.cleanup();
  });
});

describe("raw-frame/re-call-path", () => {
  // Through solid-web's slotsFor every invoked occurrence registers
  // ctx.onUpdate (live props), so a stream args-change NEVER re-calls there.
  // The frame-level re-call contract still exists for consumers whose slot
  // callbacks don't register updaters — pin it with a raw frame.
  test("an args change without a live-props registration re-calls the occurrence: fresh invocation, prior DOM replaced (state reset)", async () => {
    const { host } = makeHost();
    const calls: string[] = [];
    const { element, dispose } = createFrameElement({
      host,
      id: "raw/recall",
      slots: {
        comment: (props: any) => {
          calls.push(props.text);
          const li = document.createElement("li");
          li.textContent = props.text;
          return li;
        }
      }
    });
    document.body.appendChild(element);

    host.apply({
      type: "slot",
      id: "raw/recall",
      version: 1,
      key: "comment#0",
      args: { text: "first" }
    });
    host.apply({
      type: "html",
      id: "raw/recall",
      version: 1,
      html: "<ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul>"
    });
    const li1 = element.querySelector("li")!;
    expect(calls).toEqual(["first"]);
    expect(li1.textContent).toBe("first");
    (li1 as HTMLElement).dataset.old = "yes";

    // Changed args, no updater registered: the frame re-calls.
    host.apply({
      type: "slot",
      id: "raw/recall",
      version: 2,
      key: "comment#0",
      args: { text: "second" }
    });
    const li2 = element.querySelector("li")!;
    expect(calls).toEqual(["first", "second"]);
    expect(li2.textContent).toBe("second");
    expect(li2).not.toBe(li1); // prior invocation's DOM replaced — state reset
    expect((li2 as HTMLElement).dataset.old).toBeUndefined();

    dispose();
    element.remove();
  });

  test("ctx.onCleanup fires once at occurrence unmount; a later frame dispose does not double-fire it", () => {
    const { host } = makeHost();
    const cleaned: string[] = [];
    const { element, dispose } = createFrameElement({
      host,
      id: "raw/cleanup",
      slots: {
        comment: (props: any, ctx: any) => {
          ctx.onCleanup(() => cleaned.push(props.text));
          const li = document.createElement("li");
          li.textContent = props.text;
          return li;
        }
      }
    });
    document.body.appendChild(element);

    host.apply({
      type: "slot",
      id: "raw/cleanup",
      version: 1,
      key: "comment#0",
      args: { text: "c0" }
    });
    host.apply({
      type: "html",
      id: "raw/cleanup",
      version: 1,
      html: "<ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul>"
    });
    expect(element.querySelector("li")!.textContent).toBe("c0");
    expect(cleaned).toEqual([]);

    // The occurrence disappears from the next version's content: unmount.
    host.apply({ type: "html", id: "raw/cleanup", version: 2, html: "<ul></ul>" });
    expect(element.querySelector("li")).toBe(null);
    expect(cleaned).toEqual(["c0"]);

    // Frame dispose must not run the already-unmounted occurrence's cleanups
    // again (no double-dispose).
    dispose();
    expect(cleaned).toEqual(["c0"]);
    element.remove();
  });
});
