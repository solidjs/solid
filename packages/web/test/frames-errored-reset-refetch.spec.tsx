/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// A frame's error is an errored async value (frames-rulings 3.3; A0,
// corollary 4 outward): the enclosing client `<Errored>` sees ONE errored
// async value — exactly as any `createAsync` that rejects — and its `reset`
// re-asks. The mechanism (A7):
//
//  1. The landing rejects on `:error`. `createFrameHost.landing(address)`
//     is a promise rejected with the error record at the response's error
//     write (it used to resolve: "the root, the stream's error, or its
//     completion"); the mount's content node throws it, so the covering
//     `<Loading>` never releases over an EMPTY `<solid-frame>` and the
//     nearest client `<Errored>` catches.
//  2. `reset` re-asks. The `<Errored>`'s `reset` recomputes the node that
//     threw; it re-reads `host.landing(address)`, and an errored landing is
//     not a landing for a fresh consumer — the re-read is a NEW flight for
//     the same address. The call lives in `dynamic`'s hoisted factory memo
//     (computed once; a reset re-creates nothing above the node), so the
//     mount asks for itself: the handler records the call behind every
//     address it handles (`callFor`) and the client re-invokes it.
//  3. An error AFTER the landing — the same response erroring after its
//     root, a refetch's response erroring — is the L2 "errored flight after
//     a landing" case: the node errors as an async iterable that yielded
//     and then threw does (the shown value is not kept beside the error);
//     the `<Errored>` fallback replaces the content, `reset` re-asks.
//  4. With no client `<Errored>` the error propagates as any uncaught async
//     error: the core halts the reactive system (`REACTIVITY_HALTED`,
//     reported through `reportError`).
//
// A server-side `<Errored>` that caught the failure is a SUCCESSFUL frame
// (its fallback is content); a keyed error chunk (a fragment's or a live
// hole's diagnostic) is not the frame's error. Both are controls here.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, Errored, Loading, resetErrorHalt } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import { createServerReference, GET } from "../server-functions/src/client.js";
import { frameAddress } from "../server-functions/src/shared.js";
import { makeHost, frameResponse, openFrameResponse, pump } from "./lifecycle-matrix/harness.js";

const html = (text: string) => `<article><p>${text}</p></article>`;
const errored = (id: string, message: string) =>
  frameResponse(id, [
    { type: "start", id, version: 1 },
    { type: "error", id, version: 1, error: { message } },
    // The server's own shape: a synchronous render failure writes the
    // error, then ends the stream (`sink.error("")` + `sink.end()`).
    { type: "complete", id, version: 1 }
  ]);
const content = (id: string, text: string) =>
  frameResponse(id, [
    { type: "start", id, version: 1 },
    { type: "html", id, version: 1, html: html(text) },
    { type: "complete", id, version: 1 }
  ]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetErrorHalt();
});

/** Mount `code` into the body; returns the root element and a cleanup. */
function mount(code: () => any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>{code()}</div>;
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

describe("a frame's error is an errored async value (3.3)", () => {
  test("(a) the frame errors → the client <Errored> catches (never an empty frame) → reset() → a new request, the new content shows", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: any, init: any) => {
      call++;
      requests.push(`${init?.method || "GET"} ${String(url)}`);
      return call === 1 ? errored("srv", "boom") : content("srv", "recovered");
    });
    const getStory = createServerReference("frames-reset/story");
    const Page = dynamic(() => getStory() as any);
    let resetFn: (() => void) | undefined;
    const m = mount(() => (
      <Errored
        fallback={(err, reset) => {
          resetFn = reset;
          return <span class="err">failed: {(err() as any)?.message}</span>;
        }}
      >
        <Loading fallback={<span class="shell">shell-fallback</span>}>
          <Page />
        </Loading>
      </Errored>
    ));
    await pump();

    // STEP 1 — the frame's `:error` is the enclosing client <Errored>'s:
    // the fallback shows the error record, no `<solid-frame>` is on screen
    // (the <Loading> did not release over an empty one), and the record is
    // still the frame's diagnostic.
    expect(call).toBe(1);
    expect(m.div.querySelector(".err")!.textContent).toBe("failed: boom");
    expect(m.div.querySelector("solid-frame")).toBeNull();
    expect(m.div.querySelector(".shell")).toBeNull();
    const frame: any = host.get(frameAddress("frames-reset/story"));
    expect(frame.error).toEqual({ message: "boom" });

    // STEP 2 — `reset` re-asks: a NEW request for the same address, the
    // <Loading> covers the flight, the new content shows.
    resetFn!();
    await pump(1);
    expect(call).toBe(2);
    await pump();
    expect(m.div.querySelector("p")!.textContent).toBe("recovered");
    expect(m.div.querySelector(".err")).toBeNull();
    expect(frame.error).toBeUndefined();
    // The same call, re-made as it was made: the data address of the same
    // function, the same transport.
    expect(requests[1]).toBe(requests[0]);

    m.cleanup();
  });

  test("(a') the <Errored> INSIDE the <Loading>: the error is caught there and the boundary reveals the fallback", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call++;
      return call === 1 ? errored("srv", "boom") : content("srv", "recovered");
    });
    const getStory = createServerReference("frames-reset/inner");
    const Page = dynamic(() => getStory() as any);
    let resetFn: (() => void) | undefined;
    const m = mount(() => (
      <Loading fallback={<span class="shell">shell-fallback</span>}>
        <Errored
          fallback={(err, reset) => {
            resetFn = reset;
            return <span class="err">failed: {(err() as any)?.message}</span>;
          }}
        >
          <Page />
        </Errored>
      </Loading>
    ));
    await pump();
    expect(m.div.querySelector(".err")!.textContent).toBe("failed: boom");
    expect(m.div.querySelector(".shell")).toBeNull();
    expect(m.div.querySelector("solid-frame")).toBeNull();

    resetFn!();
    await pump();
    expect(call).toBe(2);
    expect(m.div.querySelector("p")!.textContent).toBe("recovered");
    expect(m.div.querySelector(".err")).toBeNull();
    m.cleanup();
  });

  test("(b) the re-ask keeps the call's declaration: a GET-declared read is re-asked over GET", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (url: any, init: any) => {
      call++;
      methods.push(`${init?.method} ${new URL(String(url), "http://x").searchParams.get("args")}`);
      return call === 1 ? errored("srv", "boom") : content("srv", "recovered");
    });
    const getStory = GET(createServerReference("frames-reset/get"));
    const Page = dynamic(() => getStory(7, "x") as any);
    let resetFn: (() => void) | undefined;
    const m = mount(() => (
      <Errored
        fallback={(_err, reset) => {
          resetFn = reset;
          return <span class="err">failed</span>;
        }}
      >
        <Page />
      </Errored>
    ));
    await pump();
    expect(m.div.querySelector(".err")).not.toBeNull();
    resetFn!();
    await pump();
    expect(call).toBe(2);
    expect(methods[0]).toBe('GET [7,"x"]');
    expect(methods[1]).toBe(methods[0]);
    expect(m.div.querySelector("p")!.textContent).toBe("recovered");
    m.cleanup();
  });

  test("(c) a re-ask whose call fails on the wire errors the node with that failure; a further reset re-asks again", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call++;
      if (call === 1) return errored("srv", "boom");
      if (call === 2) throw new Error("offline");
      return content("srv", "recovered");
    });
    const getStory = createServerReference("frames-reset/wire");
    const Page = dynamic(() => getStory() as any);
    let resetFn: (() => void) | undefined;
    const m = mount(() => (
      <Errored
        fallback={(err, reset) => {
          resetFn = reset;
          return <span class="err">failed: {String((err() as any)?.message)}</span>;
        }}
      >
        <Page />
      </Errored>
    ));
    await pump();
    expect(m.div.querySelector(".err")!.textContent).toBe("failed: boom");
    resetFn!();
    await pump();
    expect(call).toBe(2);
    expect(m.div.querySelector(".err")!.textContent).toBe("failed: offline");
    resetFn!();
    await pump();
    expect(call).toBe(3);
    expect(m.div.querySelector("p")!.textContent).toBe("recovered");
    m.cleanup();
  });

  test("(d) with NO client <Errored> the error propagates as any uncaught async error: the reactive system halts (REACTIVITY_HALTED) and the cause is reported", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () => errored("srv", "boom"));
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", (e: unknown) => reported.push(e));
    // The halt also RETHROWS out of the flush that met the error — a
    // scheduled one here (the error lands from a chunk microtask), which
    // in a browser reaches `window.onerror`; the run's microtask is wrapped
    // so the rethrow is observed instead of failing the suite.
    const rethrown: unknown[] = [];
    const queue = queueMicrotask;
    vi.stubGlobal("queueMicrotask", (fn: () => void) =>
      queue(() => {
        try {
          fn();
        } catch (e) {
          rethrown.push(e);
        }
      })
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const getStory = createServerReference("frames-reset/uncaught");
    const Page = dynamic(() => getStory() as any);
    const m = mount(() => (
      <Loading fallback={<span class="shell">shell-fallback</span>}>
        <Page />
      </Loading>
    ));
    await pump();
    const halt = error.mock.calls.find(args => /REACTIVITY_HALTED/.test(String(args[0])));
    expect(halt).toBeDefined();
    expect(reported).toEqual([{ message: "boom" }]);
    expect(rethrown.length).toBe(1);
    // Nothing invented at the position: no empty frame was revealed.
    expect(m.div.querySelector("solid-frame")).toBeNull();
    m.cleanup();
  });

  test("(e) a frame that errors AFTER a successful landing: the node errors (the L2 errored-flight-after-a-landing case), the <Errored> fallback replaces the content, reset() re-asks", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    const held = openFrameResponse("srv");
    vi.stubGlobal("fetch", async () => {
      call++;
      return call === 1 ? held.response : content("srv", "recovered");
    });
    const getStory = createServerReference("frames-reset/late");
    const Page = dynamic(() => getStory() as any);
    let resetFn: (() => void) | undefined;
    const m = mount(() => (
      <Errored
        fallback={(err, reset) => {
          resetFn = reset;
          return <span class="err">failed: {(err() as any)?.message}</span>;
        }}
      >
        <Loading fallback={<span class="shell">shell-fallback</span>}>
          <Page />
        </Loading>
      </Errored>
    ));
    await pump();
    held.send({ type: "start", id: "srv", version: 1 });
    held.send({ type: "html", id: "srv", version: 1, html: html("landed") });
    await pump();
    expect(m.div.querySelector("p")!.textContent).toBe("landed");
    expect(m.div.querySelector(".err")).toBeNull();

    // A later yield fails: the frame — one async value — errors.
    held.send({ type: "error", id: "srv", version: 1, error: { message: "late-boom" } });
    held.close();
    await pump();
    expect(m.div.querySelector(".err")!.textContent).toBe("failed: late-boom");
    expect(m.div.querySelector("p")).toBeNull();
    const frame: any = host.get(frameAddress("frames-reset/late"));
    expect(frame.error).toEqual({ message: "late-boom" });

    resetFn!();
    await pump();
    expect(call).toBe(2);
    expect(m.div.querySelector("p")!.textContent).toBe("recovered");
    expect(m.div.querySelector(".err")).toBeNull();
    m.cleanup();
  });

  test("(e') a stream cut off after its landing (undeclared death, D1) is such an error too", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const held = openFrameResponse("srv");
    vi.stubGlobal("fetch", async () => held.response);
    const getStory = createServerReference("frames-reset/truncated");
    const Page = dynamic(() => getStory() as any);
    const m = mount(() => (
      <Errored fallback={err => <span class="err">failed: {(err() as any)?.message}</span>}>
        <Loading fallback={<span class="shell">shell-fallback</span>}>
          <Page />
        </Loading>
      </Errored>
    ));
    await pump();
    held.send({ type: "start", id: "srv", version: 1 });
    held.send({ type: "html", id: "srv", version: 1, html: html("partial") });
    await pump();
    expect(m.div.querySelector("p")!.textContent).toBe("partial");
    held.close();
    await pump();
    expect(m.div.querySelector(".err")!.textContent).toContain("before the frame completed");
    expect(m.div.querySelector("p")).toBeNull();
    m.cleanup();
  });

  test("(f) a refetch whose response errors: the shown value is not kept beside the error — the <Errored> fallback shows, reset() re-asks", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call++;
      return call === 2 ? errored("srv", "refetch-boom") : content("srv", `story ${call}`);
    });
    const getStory = createServerReference("frames-reset/refetch");
    const [tick, setTick] = createSignal(0);
    const Page = dynamic(() => (tick(), getStory() as any));
    let resetFn: (() => void) | undefined;
    const m = mount(() => (
      <Errored
        fallback={(err, reset) => {
          resetFn = reset;
          return <span class="err">failed: {(err() as any)?.message}</span>;
        }}
      >
        <Loading fallback={<span class="shell">shell-fallback</span>}>
          <Page />
        </Loading>
      </Errored>
    ));
    await pump();
    expect(m.div.querySelector("p")!.textContent).toBe("story 1");

    setTick(1);
    await pump();
    expect(call).toBe(2);
    expect(m.div.querySelector(".err")!.textContent).toBe("failed: refetch-boom");
    expect(m.div.querySelector("p")).toBeNull();

    resetFn!();
    await pump();
    expect(call).toBe(3);
    expect(m.div.querySelector("p")!.textContent).toBe("story 3");
    expect(m.div.querySelector(".err")).toBeNull();
    m.cleanup();
  });

  test("(g) control: a failure the SERVER's <Errored> caught is a successful frame — its fallback is content; a keyed error chunk is a diagnostic, not the frame's error", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    vi.stubGlobal("fetch", async () =>
      frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        {
          type: "html",
          id: "srv",
          version: 1,
          html:
            '<article><em class="server-fallback">server caught: boom</em>' +
            '<template id="pl-a"><span>loading-a</span></template><!--pl-a--></article>'
        },
        // A fragment that errored under a server <Errored>: its html is the
        // boundary's fallback and the failure rides as a KEYED error chunk.
        { type: "fragment", id: "srv", version: 1, key: "a", html: "<i>frag caught</i>" },
        { type: "error", id: "srv", version: 1, key: "a", error: { message: "frag-boom" } },
        { type: "reveal", id: "srv", version: 1, keys: ["a"], waitForStyles: false },
        { type: "complete", id: "srv", version: 1 }
      ])
    );
    const getStory = createServerReference("frames-reset/server-caught");
    const Page = dynamic(() => getStory() as any);
    const m = mount(() => (
      <Errored fallback={<span class="err">client fallback</span>}>
        <Loading fallback={<span class="shell">shell-fallback</span>}>
          <Page />
        </Loading>
      </Errored>
    ));
    await pump();
    expect(m.div.querySelector(".server-fallback")!.textContent).toBe("server caught: boom");
    expect(m.div.querySelector("i")!.textContent).toBe("frag caught");
    expect(m.div.querySelector(".err")).toBeNull();
    const frame: any = host.get(frameAddress("frames-reset/server-caught"));
    expect(frame.error).toBeUndefined();
    expect(frame.store["seg:a:error"]).toEqual({ message: "frag-boom" });
    m.cleanup();
  });
});
