/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Lifecycle matrix — mount kind: T=0 DOCUMENT ADOPTION. The page arrives with
// SSR'd `<dx-frame data-fid>` boundaries and `sc:slot:` hydration records;
// mounting the server component's placeholder adopts the element in place
// with ZERO network, and later streams morph the adopted content.
//
// The boundary element index is a once-per-boot module cache (first lookup
// scans the document), so every test's boundary is seeded into ONE document
// up front, before the first lookup, and each test adopts its own fid.
//
// NOTE on claims: this vitest config doesn't compile hydratable JSX (no
// `_hk` keys), so claimRender's registry path can't engage — a JSX slot fill
// re-renders fresh nodes over the server interior instead of claiming it.
// The claim-in-place contract is pinned at the FRAME level here (a raw
// adopt-mode frame whose callback answers `undefined`); the compiled-JSX
// claim half lives in the dom-expressions runtime suites.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, createSignal, flush, isPending, Loading } from "solid-js";
import { dynamic } from "../../src/index.js";
import { installServerComponents, createFrame } from "../../frames/src/client.js";
import { createServerReference } from "@solidjs/web/server-functions/client";
import { makeHost, openFrameResponse, pump } from "./harness.js";

const getBasic = createServerReference("matrix/adopt/basic");
const getMorph = createServerReference("matrix/adopt/morph");
const getRecords = createServerReference("matrix/adopt/records");
const getAsyncArg = createServerReference("matrix/adopt/async-arg");
const getSwitch = createServerReference("matrix/adopt/switch");

// The async arg riding the t=0 record (document-adoption × arg tiers, client
// half): in a real page seroval deserializes the record's async value back
// to a live promise that the document's data scripts later resolve; here the
// deferred stands in for it.
let resolveAsyncArg!: (v: any) => void;
const asyncArgPromise = new Promise(r => (resolveAsyncArg = r));

function boundaryHtml(fid: string, title: string) {
  return (
    `<dx-frame data-fid="${fid}" style="display:contents">` +
    `<article><h1>${title}</h1>` +
    "<ul><!--slot:comment#c1:start-->" +
    '<li class="ssr-fill">server-rendered-fill</li>' +
    "<!--slot:comment#c1:end--></ul></article>" +
    "</dx-frame>"
  );
}

beforeAll(() => {
  // The whole page, before any boundary lookup: one SSR'd boundary per test.
  document.body.innerHTML =
    '<div id="page">' +
    boundaryHtml("matrix/adopt/basic", "Basic") +
    boundaryHtml("matrix/adopt/morph", "Morph") +
    boundaryHtml("matrix/adopt/records", "Records") +
    boundaryHtml("matrix/adopt/async-arg", "AsyncArg") +
    boundaryHtml("matrix/adopt/switch", "AdoptedZero") +
    "</div>";
  (window as any)._$HY = {
    r: {
      "sc:slot:matrix/adopt/basic:comment#c1": { cid: "c1" },
      "sc:slot:matrix/adopt/morph:comment#c1": { cid: "c1" },
      "sc:slot:matrix/adopt/records:comment#c1": { cid: "c1" },
      "sc:slot:matrix/adopt/async-arg:comment#c1": { cid: "c1", stats: asyncArgPromise },
      "sc:slot:matrix/adopt/switch:comment#c1": { cid: "c1" }
    }
  };
});

afterAll(() => {
  delete (window as any)._$HY;
  document.body.innerHTML = "";
});

afterEach(() => vi.unstubAllGlobals());

function mountUnderLoading(Comp: any, props: Record<string, any> = {}) {
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
    dispose,
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

describe("t=0/adopt-basics", () => {
  test("the call is answered locally: the SSR'd element is adopted in place, slot args come from the document's records, zero network", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called at t=0");
    });

    const ssrEl = document.querySelector('[data-fid="matrix/adopt/basic"]')!;
    const seenArgs: any[] = [];
    const Page = dynamic(() => getBasic() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        seenArgs.push(p.cid);
        return <li class="live-fill">live:{p.cid}</li>;
      }
    });
    await pump();

    // Adopted, not re-created: the boundary in the page IS the SSR'd node.
    expect(document.querySelector('[data-fid="matrix/adopt/basic"]')).toBe(ssrEl);
    // Server content untouched; the occurrence armed with the t=0 record.
    expect(ssrEl.querySelector("h1")!.textContent).toBe("Basic");
    expect(seenArgs).toEqual(["c1"]);
    expect(ssrEl.textContent).toContain("live:c1");
    // The mount adopted, so no fallback ever showed.
    expect(m.div.textContent).not.toContain("shell-fallback");

    m.cleanup();
  });
});

describe("t=0/post-adoption-stream", () => {
  test("a later stream MORPHS the adopted content in place; a slot fill's signal state survives the morph", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });

    let bump!: () => void;
    const Page = dynamic(() => getMorph() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        const [n, setN] = createSignal(0);
        bump = () => setN(n() + 1);
        return (
          <li class="live-fill">
            {p.cid}:{n()}
          </li>
        );
      }
    });
    await pump();

    const ssrEl = document.querySelector('[data-fid="matrix/adopt/morph"]')! as HTMLElement;
    const h1 = ssrEl.querySelector("h1")!;
    const li = ssrEl.querySelector(".live-fill")! as HTMLElement;
    expect(h1.textContent).toBe("Morph");
    bump();
    flush();
    expect(li.textContent).toBe("c1:1");

    // A navigation-shaped stream lands on the adopted boundary (the document
    // wire id IS the argless call's address).
    host.apply({
      type: "html",
      id: "matrix/adopt/morph",
      version: 1,
      html:
        "<article><h1>Morphed</h1>" +
        "<ul><!--slot:comment#c1:start--><!--slot:comment#c1:end--></ul></article>"
    });
    await pump(1);

    // In-place morph: same h1 node, new text; the slot range — and the
    // client state inside it — survived.
    expect(ssrEl.querySelector("h1")).toBe(h1);
    expect(h1.textContent).toBe("Morphed");
    expect(ssrEl.querySelector(".live-fill")).toBe(li);
    expect(li.textContent).toBe("c1:1");

    m.cleanup();
  });
});

describe("t=0/adopted-occurrence-records", () => {
  test("a re-sent identical record doesn't re-call the adopted occurrence; a changed record updates it live", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called");
    });

    let mounts = 0;
    const reads: string[] = [];
    const Page = dynamic(() => getRecords() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        mounts++;
        createMemo(() => reads.push(p.cid));
        return <li class="live-fill">{p.cid}</li>;
      }
    });
    await pump();
    expect(mounts).toBe(1);
    expect(reads).toEqual(["c1"]);
    const li = document
      .querySelector('[data-fid="matrix/adopt/records"]')!
      .querySelector(".live-fill")!;

    // Identical re-send (a stream repeating the t=0 record): dedupe.
    host.apply({
      type: "slot",
      id: "matrix/adopt/records",
      version: 1,
      key: "comment#c1",
      args: { cid: "c1" }
    });
    await pump(1);
    expect(mounts).toBe(1);
    expect(reads).toEqual(["c1"]);

    // A genuine change: live props update the adopted instance in place.
    host.apply({
      type: "slot",
      id: "matrix/adopt/records",
      version: 2,
      key: "comment#c1",
      args: { cid: "c2" }
    });
    await pump(1);
    expect(mounts).toBe(1);
    expect(reads).toEqual(["c1", "c2"]);
    expect(
      document.querySelector('[data-fid="matrix/adopt/records"]')!.querySelector(".live-fill")
    ).toBe(li);
    expect(li.textContent).toBe("c2");

    m.cleanup();
  });
});

describe("t=0/adopt-async-arg", () => {
  // Document-adoption × arg tiers, client half (DR-2 value tier at t=0): an
  // async value riding the t=0 record must reach the adopted fill through
  // the async-read wrap — the read suspends into the fill's own covering
  // boundary and settles when the value does — never as the raw promise.
  // (The server half — the inline render suspending the same read during
  // document SSR — is pinned in test/server/document-face-arg-tiers.spec.tsx.)
  test("an async arg in the t=0 record suspends the adopted fill's read and settles in place", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch must not be called at t=0");
    });

    const Page = dynamic(() => getAsyncArg() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => (
        <Loading fallback={<li class="pending">pending</li>}>
          <li class="live-fill">
            stat:{p.stats}:{p.cid}
          </li>
        </Loading>
      )
    });
    await pump();

    const ssrEl = document.querySelector('[data-fid="matrix/adopt/async-arg"]')! as HTMLElement;
    // Pending: the read suspended into the fill's own boundary — the raw
    // promise never rendered ("[object Promise]" is the failure shape).
    expect(ssrEl.textContent).toContain("pending");
    expect(ssrEl.textContent).not.toContain("object Promise");

    resolveAsyncArg(42);
    await pump(2);
    flush();
    expect(ssrEl.textContent).toContain("stat:42:c1");

    m.cleanup();
  });
});

describe("t=0/raw-frame-claim", () => {
  test("an adopt-mode frame's slot callback answering `undefined` CLAIMS the server interior — nothing moves, and later morphs still protect it", () => {
    const { host } = makeHost();
    // The record buffered before the frame exists (t=0 record drain shape).
    host.apply({
      type: "slot",
      id: "raw/adopt-claim",
      version: 0,
      key: "comment#c1",
      args: { cid: "c1" }
    });

    const el = document.createElement("dx-frame");
    el.setAttribute("data-fid", "raw/adopt-claim");
    el.innerHTML =
      "<article><h1>Raw</h1><!--slot:comment#c1:start-->" +
      '<div class="keep">server-fill</div>' +
      "<!--slot:comment#c1:end--></article>";
    document.body.appendChild(el);
    const keep = el.querySelector(".keep")!;

    const calls: any[] = [];
    const frame: any = createFrame(el, {
      adopt: true,
      host,
      id: "raw/adopt-claim",
      slots: {
        comment: (props: any, ctx: any) => {
          calls.push({ cid: props.cid, adopted: ctx.adopted, existing: ctx.existing.length });
          return undefined; // the claim: existing DOM is my output
        }
      }
    });

    // One hydration-attach invocation, with the record's args and the
    // server-rendered interior offered as `existing`.
    expect(calls).toEqual([{ cid: "c1", adopted: true, existing: 1 }]);
    expect(el.querySelector(".keep")).toBe(keep); // untouched

    // A later root morph re-sends the shell: the claimed range is protected.
    host.apply({
      type: "html",
      id: "raw/adopt-claim",
      version: 1,
      html: "<article><h1>Raw2</h1><!--slot:comment#c1:start--><!--slot:comment#c1:end--></article>"
    });
    expect(el.querySelector("h1")!.textContent).toBe("Raw2");
    expect(el.querySelector(".keep")).toBe(keep);
    expect(calls).toHaveLength(1);

    frame.dispose();
    el.remove();
  });
});

describe("t=0/adopted-switch-gate", () => {
  // #2977, adopted face: the t=0 mount adopted the SSR'd element with zero
  // network, and a LATER args change on the same site resolves at response-
  // header time — which is not an answer. Until the new address's first
  // content applies, the boundary still shows the t=0 call's content, and
  // the source that drove the switch must keep reading pending (this is the
  // notes-search shape: initial adopted sidebar, then a search param). The
  // call-driven half of this gate lives in call-driven-lifecycle.
  test("an args switch on an adopted site holds the source's pending state until the new address's first content applies", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const held = openFrameResponse("srv");
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return held.response;
    });

    const [q, setQ] = createSignal<number | undefined>(undefined);
    const Page = dynamic(() => (q() === undefined ? getSwitch() : getSwitch(q())) as any);

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <span data-probe>{isPending(q) ? "pending" : "idle"}</span>
        <Loading fallback={<span>shell-fallback</span>}>
          <Page comment={(p: any) => <li class="live-fill">live:{p.cid}</li>} />
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    const probe = () => div.querySelector("[data-probe]")!.textContent;
    const ssrEl = document.querySelector('[data-fid="matrix/adopt/switch"]')! as HTMLElement;

    await pump();
    // t=0: adopted in place, zero network, nothing pending.
    expect(calls).toBe(0);
    expect(ssrEl.querySelector("h1")!.textContent).toBe("AdoptedZero");
    expect(probe()).toBe("idle");

    // The switch: a real request this time, headers resolve immediately,
    // content held. The adopted content stays (the morph model) and the
    // source reads pending until the new address answers.
    setQ(1);
    await pump();
    expect(calls).toBe(1);
    expect(ssrEl.querySelector("h1")!.textContent).toBe("AdoptedZero");
    expect(probe()).toBe("pending");

    held.send({ type: "start", id: "srv", version: 1 });
    held.send({ type: "slot", id: "srv", version: 1, key: "comment#c1", args: { cid: "c1" } });
    held.send({
      type: "html",
      id: "srv",
      version: 1,
      html:
        "<article><h1>SwitchedOne</h1>" +
        "<ul><!--slot:comment#c1:start--><!--slot:comment#c1:end--></ul></article>"
    });
    held.close();
    await pump();
    expect(ssrEl.querySelector("h1")!.textContent).toBe("SwitchedOne");
    expect(probe()).toBe("idle");

    dispose();
    container.remove();
  });
});
