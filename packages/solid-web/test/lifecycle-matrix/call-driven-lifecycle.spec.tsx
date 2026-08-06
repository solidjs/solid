/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Lifecycle matrix — mount kind: FRESH CALL-DRIVEN MOUNT (`dynamic()` over a
// server-function call), crossed with the RESPONSE LIFECYCLE and
// LOADING/REVEAL GATING dimensions. Slot behavior, arg tiers and state
// survival live in call-driven-slots / call-driven-args; other mount kinds
// have their own spec files. See MATRIX.md for the full cell table.
import { afterEach, describe, expect, test } from "vitest";
import { vi } from "vitest";
import { createRoot, createSignal, flush, Loading } from "solid-js";
import { dynamic } from "../../src/index.js";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "@dom-expressions/runtime/src/server-functions/client.js";
import { makeHost, frameResponse, openFrameResponse, dataChunks, pump } from "./harness.js";

// One reference per matrix row; ids are namespaced so nothing collides with
// other suites' claimed-boundary bookkeeping.
const getSingle = createServerReference("matrix/lc/single");
const getMorph = createServerReference("matrix/lc/morph");
const getRefetch = createServerReference("matrix/lc/refetch");
const getErrEarly = createServerReference("matrix/lc/err-early");
const getErrLate = createServerReference("matrix/lc/err-late");
const getErrRecover = createServerReference("matrix/lc/err-recover");
const getTruncated = createServerReference("matrix/lc/truncated");
const getAborted = createServerReference("matrix/lc/aborted");
const getReveal = createServerReference("matrix/lc/reveal");
const getFallbackGate = createServerReference("matrix/lc/fallback-gate");
const getShellGate = createServerReference("matrix/lc/shell-gate");
const getShellErr = createServerReference("matrix/lc/shell-err");

function articleHtml(title: string) {
  return (
    `<article><h1>${title}</h1>` +
    "<ul><!--slot:comment#0:start--><!--slot:comment#0:end--></ul>" +
    "</article>"
  );
}

/** Mount `<Loading fallback=…><Comp {...props}/></Loading>` into the body. */
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

afterEach(() => vi.unstubAllGlobals());

describe("call-driven/single-response", () => {
  test("start → data → slot → html → complete: content, resolved slot args and the complete flag all land", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        // Data records ride ahead of the slot record that references them.
        ...dataChunks("srv", 1, { t1: { label: "hello" } }),
        {
          type: "slot",
          id: "srv",
          version: 1,
          key: "comment#0",
          args: { text: { $ref: "t1" }, n: 7 }
        },
        { type: "html", id: "srv", version: 1, html: articleHtml("Single") },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    const Page = dynamic(() => getSingle() as any);
    const m = mountUnderLoading(Page, {
      comment: (p: any) => (
        <li>
          {p.text.label}:{p.n}
        </li>
      )
    });
    await pump();

    expect(m.div.querySelector("h1")!.textContent).toBe("Single");
    expect(m.div.querySelector("ul li")!.textContent).toBe("hello:7");
    expect(m.div.textContent).not.toContain("shell-fallback");
    // The stream-control records surface through the frame's store.
    const frame: any = host.get("matrix/lc/single");
    expect(frame.store[":complete"]).toBe(true);
    expect(frame.error).toBeUndefined();

    m.cleanup();
  });
});

describe("call-driven/second-response-same-version", () => {
  // The real transport restamps every response with a fresh client version,
  // so a SAME-version second response can only be produced by driving the
  // host directly — which is exactly what this cell pins: equal-version
  // writes are accepted as morphs (only OLDER versions are stale).
  test("same-version root re-send morphs in place: node identity and slot interiors survive", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: { text: "c" } },
        { type: "html", id: "srv", version: 1, html: articleHtml("One") },
        { type: "complete", id: "srv", version: 1 }
      ])
    );

    const Page = dynamic(() => getMorph() as any);
    const m = mountUnderLoading(Page, { comment: (p: any) => <li>{p.text}</li> });
    await pump();

    const h1 = m.div.querySelector("h1")!;
    const li = m.div.querySelector("ul li")! as HTMLElement;
    expect(h1.textContent).toBe("One");
    li.dataset.keep = "yes";

    // Same version (the transport stamped version 1), new root html.
    host.apply({ type: "html", id: "matrix/lc/morph", version: 1, html: articleHtml("Two") });
    await pump(1);

    expect(m.div.querySelector("h1")).toBe(h1);
    expect(h1.textContent).toBe("Two");
    expect(m.div.querySelector("ul li")).toBe(li);
    expect(li.dataset.keep).toBe("yes");

    m.cleanup();
  });
});

describe("call-driven/second-response-newer-version", () => {
  test("refetch morph: content morphs in place, re-sent equivalent slot records don't re-call, per-response error state clears", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call++;
      return frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "slot", id: "srv", version: 1, key: "comment#0", args: { text: "same" } },
        { type: "html", id: "srv", version: 1, html: articleHtml(`Story ${call}`) },
        { type: "complete", id: "srv", version: 1 }
      ]);
    });

    const [tick, setTick] = createSignal(0);
    let mounts = 0;
    const Page = dynamic(() => (tick(), getRefetch() as any));
    const m = mountUnderLoading(Page, {
      comment: (p: any) => {
        mounts++;
        return <li>{p.text}</li>;
      }
    });
    await pump();

    const h1 = m.div.querySelector("h1")!;
    const li = m.div.querySelector("ul li")! as HTMLElement;
    expect(h1.textContent).toBe("Story 1");
    expect(mounts).toBe(1);
    li.dataset.keep = "yes";
    // Seed a stale per-response error record; the version bump must clear it.
    host.apply({ type: "error", id: "matrix/lc/refetch", version: 1, error: { message: "old" } });
    expect((host.get("matrix/lc/refetch") as any).error).toEqual({ message: "old" });

    setTick(1);
    await pump();

    // Morph, not remount: same nodes, new server text, occurrence not re-called.
    expect(m.div.querySelector("h1")).toBe(h1);
    expect(h1.textContent).toBe("Story 2");
    expect(m.div.querySelector("ul li")).toBe(li);
    expect(li.dataset.keep).toBe("yes");
    expect(mounts).toBe(1);
    // Per-response records reset on the version bump; slot records survived.
    expect((host.get("matrix/lc/refetch") as any).error).toBeUndefined();

    m.cleanup();
  });
});

describe("call-driven/error-record", () => {
  // GAP (runtime dependency, same as shell-gate/error below): the mount now
  // gates on first apply, and an :error record only fires onApply on
  // runtimes with the error-apply notification — landed on dom-expressions
  // next, unpublished. Until the runtime dep bumps past it, an early-error
  // stream holds the fallback and never mounts the empty frame. Flips to
  // passing at the next @dom-expressions/runtime release. (frame.error
  // surfacing stays covered by error/after-html, which applies content
  // before erroring and so releases the gate.)
  test.fails(
    "error/before-html: the record surfaces through frame.error; the boundary mounts empty, not stuck on fallback",
    async () => {
      const { host } = makeHost();
      installServerComponents(host);
      vi.stubGlobal("fetch", async () =>
        frameResponse("srv", [
          { type: "start", id: "srv", version: 1 },
          { type: "error", id: "srv", version: 1, error: { message: "boom" } }
        ])
      );

      const Page = dynamic(() => getErrEarly() as any);
      const m = mountUnderLoading(Page, {});
      await pump();

      const frame: any = host.get("matrix/lc/err-early");
      expect(frame.error).toEqual({ message: "boom" });
      // No content ever streamed; the boundary element is present and empty.
      const el = m.div.querySelector("dx-frame")!;
      expect(el.textContent).toBe("");
      // The covering Loading is not stuck on its fallback.
      expect(m.div.textContent).not.toContain("shell-fallback");

      m.cleanup();
    }
  );

  test("error/after-html: applied content stays; the error is recorded, not a teardown", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "html", id: "srv", version: 1, html: articleHtml("Kept") },
        { type: "error", id: "srv", version: 1, error: { message: "late-boom" } }
      ])
    );

    const Page = dynamic(() => getErrLate() as any);
    const m = mountUnderLoading(Page, {});
    await pump();

    expect(m.div.querySelector("h1")!.textContent).toBe("Kept");
    expect((host.get("matrix/lc/err-late") as any).error).toEqual({ message: "late-boom" });

    m.cleanup();
  });

  test("error-then-recovery: a refetch's newer version clears the error record and morphs content in", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call++;
      if (call === 1) {
        return frameResponse("srv", [
          { type: "start", id: "srv", version: 1 },
          { type: "error", id: "srv", version: 1, error: { message: "boom" } }
        ]);
      }
      return frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "html", id: "srv", version: 1, html: articleHtml("Recovered") },
        { type: "complete", id: "srv", version: 1 }
      ]);
    });

    const [tick, setTick] = createSignal(0);
    const Page = dynamic(() => (tick(), getErrRecover() as any));
    const m = mountUnderLoading(Page, {});
    await pump();
    expect((host.get("matrix/lc/err-recover") as any).error).toEqual({ message: "boom" });

    setTick(1);
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("Recovered");
    expect((host.get("matrix/lc/err-recover") as any).error).toBeUndefined();

    m.cleanup();
  });
});

describe("call-driven/truncated-stream", () => {
  test("a stream that ends without complete keeps its applied content and stays refetchable", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    const held = openFrameResponse("srv");
    vi.stubGlobal("fetch", async () => {
      call++;
      if (call === 1) return held.response;
      return frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "html", id: "srv", version: 1, html: articleHtml("After") },
        { type: "complete", id: "srv", version: 1 }
      ]);
    });

    const [tick, setTick] = createSignal(0);
    const Page = dynamic(() => (tick(), getTruncated() as any));
    const m = mountUnderLoading(Page, {});
    await pump();
    held.send({ type: "start", id: "srv", version: 1 });
    held.send({ type: "html", id: "srv", version: 1, html: articleHtml("Partial") });
    // Truncation: the connection closes with no complete record.
    held.close();
    await pump();

    expect(m.div.querySelector("h1")!.textContent).toBe("Partial");
    const frame: any = host.get("matrix/lc/truncated");
    expect(frame.store[":complete"]).toBeUndefined();
    // A clean close is not an error.
    expect(frame.error).toBeUndefined();

    // The boundary is not poisoned: a refetch morphs normally.
    setTick(1);
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("After");

    m.cleanup();
  });

  test("an ABORTED stream (connection error) surfaces as an error record", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const held = openFrameResponse("srv");
    vi.stubGlobal("fetch", async () => held.response);

    const Page = dynamic(() => getAborted() as any);
    const m = mountUnderLoading(Page, {});
    await pump();
    held.send({ type: "start", id: "srv", version: 1 });
    held.send({ type: "html", id: "srv", version: 1, html: articleHtml("Partial") });
    // Let the reader drain the queued chunks first: erroring a stream drops
    // anything enqueued-but-unread, which is not the shape under test.
    await pump();
    held.abort(new Error("connection reset"));
    await pump();

    expect(m.div.querySelector("h1")!.textContent).toBe("Partial");
    const frame: any = host.get("matrix/lc/aborted");
    expect(frame.error).toBeTruthy();
    expect(String(frame.error.message)).toContain("connection reset");

    m.cleanup();
  });
});

describe("call-driven/fragment-reveal-gating", () => {
  test("fragments reveal when READY, order-independently: a reveal ahead of its content waits; content+reveal shows immediately", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const held = openFrameResponse("srv");
    vi.stubGlobal("fetch", async () => held.response);

    const Page = dynamic(() => getReveal() as any);
    const m = mountUnderLoading(Page, {});
    await pump();
    held.send({ type: "start", id: "srv", version: 1 });
    held.send({
      type: "html",
      id: "srv",
      version: 1,
      html:
        "<article>" +
        '<template id="pl-a"><span>loading-a</span></template><!--pl-a-->' +
        '<template id="pl-b"><span>loading-b</span></template><!--pl-b-->' +
        "</article>"
    });
    // Reveal gate for `a` arrives BEFORE its fragment content: nothing may
    // show for `a` yet (readiness is store+DOM-checked, not arrival order).
    held.send({ type: "reveal", id: "srv", version: 1, keys: ["a"], waitForStyles: false });
    await pump();
    expect(m.div.textContent).not.toContain("frag-a");
    expect(m.div.textContent).not.toContain("frag-b");

    // `b` gets content + reveal while `a` still waits: b shows, a doesn't.
    held.send({ type: "fragment", id: "srv", version: 1, key: "b", html: "<p>frag-b</p>" });
    held.send({ type: "reveal", id: "srv", version: 1, keys: ["b"], waitForStyles: false });
    await pump();
    expect(m.div.textContent).toContain("frag-b");
    expect(m.div.textContent).not.toContain("frag-a");

    // `a`'s content arrives last; its earlier reveal gate is already set.
    held.send({ type: "fragment", id: "srv", version: 1, key: "a", html: "<p>frag-a</p>" });
    held.send({ type: "complete", id: "srv", version: 1 });
    held.close();
    await pump();
    expect(m.div.textContent).toContain("frag-a");
    expect(m.div.querySelector("template#pl-a")).toBe(null);
    expect(m.div.querySelector("template#pl-b")).toBe(null);

    m.cleanup();
  });

  test("a FALLBACK reveal materializes the placeholder's template for a late fragment, then the real reveal swaps it out", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const held = openFrameResponse("srv");
    vi.stubGlobal("fetch", async () => held.response);

    const Page = dynamic(() => getFallbackGate() as any);
    const m = mountUnderLoading(Page, {});
    await pump();
    held.send({ type: "start", id: "srv", version: 1 });
    held.send({
      type: "html",
      id: "srv",
      version: 1,
      html: '<article><template id="pl-a"><span>seg-loading</span></template><!--pl-a--></article>'
    });
    await pump(1);
    // Template content is inert until a gate materializes it.
    expect(m.div.textContent).not.toContain("seg-loading");

    // The producer decides the segment is late: fallback gate.
    held.send({ type: "reveal", id: "srv", version: 1, keys: ["a"], fallback: true });
    await pump(1);
    expect(m.div.textContent).toContain("seg-loading");

    // Content finally lands and the real reveal swaps the fallback out.
    held.send({ type: "fragment", id: "srv", version: 1, key: "a", html: "<p>frag-a</p>" });
    held.send({ type: "reveal", id: "srv", version: 1, keys: ["a"], waitForStyles: false });
    held.send({ type: "complete", id: "srv", version: 1 });
    held.close();
    await pump();
    expect(m.div.textContent).toContain("frag-a");
    expect(m.div.textContent).not.toContain("seg-loading");

    m.cleanup();
  });
});

describe("call-driven/shell-gate", () => {
  // Closed gap: a fresh call-driven mount now gates on the frame's first
  // apply — the covering <Loading> holds from response HEAD (when the call
  // resolves and the mount exists) until the first html record applies,
  // instead of releasing over an empty <dx-frame> (the empty-frame flash).
  // Only call-driven mounts gate (the transport rotates the address's data
  // table before the binding resolves); placeholder mounts with no call in
  // flight still render their empty frame immediately.
  test("the covering <Loading> holds until the frame's FIRST CONTENT applies (no empty-frame flash)", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const held = openFrameResponse("srv");
    vi.stubGlobal("fetch", async () => held.response);

    const Page = dynamic(() => getShellGate() as any);
    const m = mountUnderLoading(Page, {});
    await pump();
    // The response HEAD has arrived (the call resolved, the mount exists) but
    // no html chunk has: the user must still see the fallback, not an empty
    // boundary where content is about to be.
    held.send({ type: "start", id: "srv", version: 1 });
    await pump();
    expect(m.div.textContent).toContain("shell-fallback");

    held.send({ type: "html", id: "srv", version: 1, html: articleHtml("Arrived") });
    held.send({ type: "complete", id: "srv", version: 1 });
    held.close();
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("Arrived");
    expect(m.div.textContent).not.toContain("shell-fallback");

    m.cleanup();
  });

  // GAP (runtime dependency): the gate releases on any apply, and an :error
  // record only fires the frame's onApply on runtimes with the error-apply
  // notification — landed on dom-expressions next, unpublished. Until the
  // runtime dep bumps past it, a failed stream holds the fallback. Flips to
  // passing at the next @dom-expressions/runtime release.
  test.fails(
    "the shell gate releases on an ERROR record too (an errored stream must not hold the fallback forever)",
    async () => {
      const { host } = makeHost();
      installServerComponents(host);
      const held = openFrameResponse("srv");
      vi.stubGlobal("fetch", async () => held.response);

      const Page = dynamic(() => getShellErr() as any);
      const m = mountUnderLoading(Page, {});
      await pump();
      held.send({ type: "start", id: "srv", version: 1 });
      held.send({ type: "error", id: "srv", version: 1, error: { message: "boom" } });
      held.close();
      await pump();

      // Whatever the error surface looks like, the page must move off the
      // fallback: the wait is over, the stream said so.
      expect(m.div.textContent).not.toContain("shell-fallback");
      expect((host.get("matrix/lc/shell-err") as any).error).toEqual({ message: "boom" });

      m.cleanup();
    }
  );
});
