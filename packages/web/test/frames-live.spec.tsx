/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Frames consume `live` (Stage 8, slice B2; RFC 11 §9.5 Client face 1–6).
// A live server component is a `live`-declared reference whose answer is a
// frame stream: the frames `responseHandler` resolves the call with the
// address's binding and hands the response's LIFETIME to the loop through
// its wire slot — the body's end, and how it ended, judged by the frames
// the server declared complete. The loop then does on frames exactly what
// it does on data: a death (the body ends with a frame still open) backs
// off and re-invokes, re-yielding the same binding into `dynamic`, whose
// equals-gate keeps the instance; a completion (every frame complete)
// completes the iteration. Supersession by another response is a death;
// an undeclared frame's death is an error; `onstatus` reports the wire.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import { createServerReference, live } from "../server-functions/src/client.js";
import { createEventChunk, frameAddress } from "../server-functions/src/shared.js";
import { makeHost, frameResponse, openFrameResponse, pump } from "./lifecycle-matrix/harness.js";

function articleHtml(title: string) {
  return (
    `<article><h1>${title}</h1>` +
    "<ul><!--slot:composer#0:start--><!--slot:composer#0:end--></ul>" +
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

/**
 * A HELD live frame response: what `serverComponentResponse` answers at the
 * live address — the frame chunks framed as server-sent events — with the
 * body left open for the test to feed, end, or break.
 */
function openLiveFrameResponse(id: string) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const state = { cancelled: undefined as unknown, aborted: undefined as unknown };
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel(reason) {
      state.cancelled = reason ?? true;
    }
  });
  return {
    response: new Response(body, {
      headers: { "X-Frame-Stream": id, "Content-Type": "text/event-stream" }
    }),
    state,
    send(chunk: any) {
      controller.enqueue(createEventChunk(JSON.stringify(chunk)));
    },
    heartbeat() {
      controller.enqueue(new TextEncoder().encode(":\n\n"));
    },
    close() {
      controller.close();
    },
    abort(err: any) {
      state.aborted = err ?? true;
      try {
        controller.error(err);
      } catch {}
    }
  };
}

/** Held live responses handed out per fetch, in order; the urls fetched. */
function stubLiveFetch(id: string, count: number) {
  const held = Array.from({ length: count }, () => openLiveFrameResponse(id));
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    urls.push(url);
    const next = held[urls.length - 1];
    if (!next) throw new Error(`unexpected fetch #${urls.length}`);
    // as fetch does: the call's signal aborting breaks the body
    if (init && init.signal)
      init.signal.addEventListener("abort", () => next.abort(init.signal.reason), { once: true });
    return next.response;
  });
  return { held, urls };
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Poll until `cond` holds (the loop's backoff is real time: 500ms first). */
async function until(cond: () => boolean, ms = 1500) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await pump(1);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("frames consume live: death vs complete", () => {
  test("a body ending with the frame open is a death: the loop reconnects, re-yields the SAME binding, and the mount morphs in place", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const { held, urls } = stubLiveFetch("srv", 2);
    const getRoom = live(createServerReference("frames-live/death"));
    const src: any = getRoom();
    const status: string[] = [];
    src.onstatus = (s: string) => status.push(s);

    let mounts = 0;
    const Page = dynamic(() => (mounts++, src));
    const m = mountUnderLoading(Page, {});
    await pump();
    // The loop calls the LIVE address.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/live/");
    held[0].send({ type: "start", id: "srv", version: 1 });
    held[0].send({ type: "html", id: "srv", version: 1, html: articleHtml("v1") });
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("v1");
    expect(m.div.textContent).not.toContain("shell-fallback");
    expect(status).toEqual(["connected"]);
    const frameEl = m.div.querySelector("solid-frame")!;
    const h1 = m.div.querySelector("h1")!;

    // A heartbeat is not a chunk.
    held[0].heartbeat();
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("v1");

    // Death: the body ends with `srv` never declared complete.
    held[0].close();
    await until(() => status.includes("reconnecting"));
    // No fallback, no remount while the loop backs off: the content stands.
    expect(m.div.textContent).not.toContain("shell-fallback");
    expect(m.div.querySelector("h1")).toBe(h1);

    await until(() => urls.length === 2);
    expect(urls[1]).toContain("/live/");
    held[1].send({ type: "start", id: "srv", version: 1 });
    held[1].send({ type: "html", id: "srv", version: 1, html: articleHtml("v2") });
    await until(() => m.div.querySelector("h1")!.textContent === "v2");
    // Same binding → same instance → the reconnect is a MORPH: the boundary
    // element and the article's nodes are the ones mounted first.
    expect(m.div.querySelector("solid-frame")).toBe(frameEl);
    expect(m.div.querySelector("h1")).toBe(h1);
    expect(mounts).toBe(1);
    expect(status).toEqual(["connected", "reconnecting", "connected"]);
    // Frames never wrote an error for the death: the loop owned it.
    expect((host.get("frames-live/death") as any).error).toBeUndefined();

    m.cleanup();
    await pump();
    // Ending the consumer ends the connection (the loop's own abort).
    expect(status.at(-1)).toBe("closed");
  });

  test("a body ending with every frame complete is a completion: the iteration closes and nothing reconnects", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const { held, urls } = stubLiveFetch("srv", 2);
    const getRoom = live(createServerReference("frames-live/complete"));
    const src: any = getRoom();
    const status: string[] = [];
    src.onstatus = (s: string) => status.push(s);

    const Page = dynamic(() => src);
    const m = mountUnderLoading(Page, {});
    await pump();
    held[0].send({ type: "start", id: "srv", version: 1 });
    held[0].send({ type: "html", id: "srv", version: 1, html: articleHtml("done") });
    held[0].send({ type: "complete", id: "srv", version: 1 });
    held[0].close();
    await until(() => status.includes("closed"));
    expect(status).toEqual(["connected", "closed"]);
    expect(m.div.querySelector("h1")!.textContent).toBe("done");
    const frame: any = host.get("frames-live/complete");
    expect(frame.store[":complete"]).toBe(true);
    expect(frame.error).toBeUndefined();

    // Past the backoff floor: no second connection.
    await wait(700);
    expect(urls).toHaveLength(1);

    m.cleanup();
  });

  test("a stream-level error record is a completion of the failing kind: no retry, the error on the frame", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const { held, urls } = stubLiveFetch("srv", 2);
    const getRoom = live(createServerReference("frames-live/refused"));
    const src: any = getRoom();
    const status: string[] = [];
    src.onstatus = (s: string) => status.push(s);

    const Page = dynamic(() => src);
    const m = mountUnderLoading(Page, {});
    await pump();
    held[0].send({ type: "start", id: "srv", version: 1 });
    held[0].send({ type: "error", id: "srv", version: 1, error: { message: "refused" } });
    held[0].close();
    await until(() => status.includes("closed"));
    expect(status).toEqual(["connected", "closed"]);
    expect((host.get("frames-live/refused") as any).error).toEqual({ message: "refused" });
    await wait(700);
    expect(urls).toHaveLength(1);

    m.cleanup();
  });
});

describe("frames consume live: supersession and undeclared death", () => {
  test("a newer response for the address from another call supersedes the live connection: the host cancels it and the loop reconnects", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const liveHeld = [openLiveFrameResponse("srv"), openLiveFrameResponse("srv")];
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      const url: string = typeof input === "string" ? input : input.url;
      urls.push(url);
      if (url.includes("/live/"))
        return liveHeld[urls.filter(u => u.includes("/live/")).length - 1].response;
      // the getter refetch: a complete frame stream at the data address
      return frameResponse("srv", [
        { type: "start", id: "srv", version: 1 },
        { type: "html", id: "srv", version: 1, html: articleHtml("refetched") },
        { type: "complete", id: "srv", version: 1 }
      ]);
    });
    const getRoom = live(createServerReference("frames-live/supersede"));
    const getRoomOnce = createServerReference("frames-live/supersede");
    const src: any = getRoom();
    const status: string[] = [];
    src.onstatus = (s: string) => status.push(s);

    const Page = dynamic(() => src);
    const m = mountUnderLoading(Page, {});
    await pump();
    liveHeld[0].send({ type: "start", id: "srv", version: 1 });
    liveHeld[0].send({ type: "html", id: "srv", version: 1, html: articleHtml("live") });
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("live");
    const h1 = m.div.querySelector("h1")!;

    // Another caller reads the same (function, args): its response writes
    // the address at a newer version.
    await getRoomOnce();
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("refetched");
    expect(m.div.querySelector("h1")).toBe(h1);
    // The live connection was cancelled by the host (the server sees the
    // disconnect), and the loop read a death.
    expect(liveHeld[0].state.cancelled).toBeTruthy();
    await until(() => status.includes("reconnecting"));
    // One reconnect, at the live address.
    await until(() => urls.filter(u => u.includes("/live/")).length === 2);
    liveHeld[1].send({ type: "start", id: "srv", version: 1 });
    liveHeld[1].send({ type: "html", id: "srv", version: 1, html: articleHtml("live again") });
    await until(() => m.div.querySelector("h1")!.textContent === "live again");
    expect(m.div.querySelector("h1")).toBe(h1);
    expect(status).toEqual(["connected", "reconnecting", "connected"]);

    m.cleanup();
  });

  test("an UNDECLARED frame's body ending before complete is an error on the frame; nothing resumes", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const held = openFrameResponse("srv");
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return held.response;
    });
    const getStory = createServerReference("frames-live/undeclared");
    const Page = dynamic(() => getStory() as any);
    const m = mountUnderLoading(Page, {});
    await pump();
    held.send({ type: "start", id: "srv", version: 1 });
    held.send({ type: "html", id: "srv", version: 1, html: articleHtml("partial") });
    held.close();
    await pump();
    const frame: any = host.get("frames-live/undeclared");
    expect(m.div.querySelector("h1")!.textContent).toBe("partial");
    expect(frame.error).toBeTruthy();
    expect(String(frame.error.message)).toContain("before the frame completed");
    await wait(700);
    expect(calls).toBe(1);

    m.cleanup();
  });
});

describe("frames consume live: one connection per address, slot state across a reconnect", () => {
  test("two live readers of one call share one connection: the second joins the first's lifetime and its own body is ended", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const { held, urls } = stubLiveFetch("srv", 4);
    const getRoom = live(createServerReference("frames-live/shared"));
    const a: any = getRoom();
    const b: any = getRoom();
    const statusA: string[] = [];
    const statusB: string[] = [];
    a.onstatus = (s: string) => statusA.push(s);
    b.onstatus = (s: string) => statusB.push(s);

    const PageA = dynamic(() => a);
    const PageB = dynamic(() => b);
    const ma = mountUnderLoading(PageA, {});
    const mb = mountUnderLoading(PageB, {});
    await pump();
    // Both loops connect; the second response is ended by the handler (the
    // server tears its render down) and its loop rides the first's.
    expect(urls).toHaveLength(2);
    expect(held[1].state.cancelled).toBeTruthy();
    expect(held[0].state.cancelled).toBeUndefined();
    held[0].send({ type: "start", id: "srv", version: 1 });
    held[0].send({ type: "html", id: "srv", version: 1, html: articleHtml("shared") });
    await pump();
    // One stream, both mounts: the host fans the address out.
    expect(ma.div.querySelector("h1")!.textContent).toBe("shared");
    expect(mb.div.querySelector("h1")!.textContent).toBe("shared");
    expect(statusA).toEqual(["connected"]);
    expect(statusB).toEqual(["connected"]);

    // The shared connection dies: both loops see it and both reconnect —
    // one owns the next connection, the other joins again.
    held[0].close();
    await until(() => statusA.includes("reconnecting") && statusB.includes("reconnecting"));
    await until(() => urls.length === 4);
    await pump();
    const cancelled = [held[2].state.cancelled, held[3].state.cancelled].filter(Boolean);
    expect(cancelled).toHaveLength(1);
    const owner = held[2].state.cancelled ? held[3] : held[2];
    owner.send({ type: "start", id: "srv", version: 1 });
    owner.send({ type: "html", id: "srv", version: 1, html: articleHtml("shared again") });
    await until(() => mb.div.querySelector("h1")!.textContent === "shared again");
    expect(ma.div.querySelector("h1")!.textContent).toBe("shared again");
    expect(statusA).toEqual(["connected", "reconnecting", "connected"]);
    expect(statusB).toEqual(["connected", "reconnecting", "connected"]);

    ma.cleanup();
    mb.cleanup();
  });

  test("a client slot's state (the composer's draft) survives a reconnect: the re-sent slot record is equivalent, the occurrence is not re-called", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const { held } = stubLiveFetch("srv", 2);
    const getRoom = live(createServerReference("frames-live/draft"));
    const src: any = getRoom();
    const status: string[] = [];
    src.onstatus = (s: string) => status.push(s);

    let composerMounts = 0;
    const Page = dynamic(() => src);
    const m = mountUnderLoading(Page, {
      composer: () => {
        composerMounts++;
        return <input class="draft" />;
      }
    });
    await pump();
    const slot = { type: "slot", id: "srv", version: 1, key: "composer#0", args: { room: "a" } };
    held[0].send({ type: "start", id: "srv", version: 1 });
    held[0].send(slot);
    held[0].send({ type: "html", id: "srv", version: 1, html: articleHtml("room v1") });
    await pump();
    const input = m.div.querySelector("input.draft") as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "half a message";
    expect(composerMounts).toBe(1);

    held[0].close();
    await until(() => status.includes("reconnecting"));
    await until(() => held[1] !== undefined && status.length === 2);
    await wait(600);
    held[1].send({ type: "start", id: "srv", version: 1 });
    held[1].send({ ...slot });
    held[1].send({ type: "html", id: "srv", version: 1, html: articleHtml("room v2") });
    await until(() => m.div.querySelector("h1")!.textContent === "room v2");
    // The composer kept its instance and its draft.
    expect(m.div.querySelector("input.draft")).toBe(input);
    expect(input.value).toBe("half a message");
    expect(composerMounts).toBe(1);

    m.cleanup();
  });
});

describe("frames consume live: argument changes at a live site", () => {
  // The memo pumps the live iterable as it pumps any async iterable — no
  // `dynamic` path of its own: a new call is a new iterable, the old
  // iteration ends (its connection with it, quietly), and the new call's
  // binding lands as the memo's next value.
  test("switching arguments ends the old connection without an error and connects the new call", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const heldByRoom = new Map<string, ReturnType<typeof openLiveFrameResponse>[]>();
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: any, init: any) => {
      const url: string = typeof input === "string" ? input : input.url;
      urls.push(url);
      // a single string argument rides as the raw body
      const room = String((init && init.body) ?? "") === "b" ? "b" : "a";
      const list = heldByRoom.get(room) ?? [];
      const next = openLiveFrameResponse("srv");
      list.push(next);
      heldByRoom.set(room, list);
      // as fetch does: the call's signal aborting breaks the body
      init.signal.addEventListener("abort", () => next.abort(init.signal.reason), { once: true });
      return next.response;
    });
    const getRoom = live(createServerReference("frames-live/switch"));
    const applied: any[] = [];
    const apply = host.apply;
    host.apply = (chunk: any) => {
      applied.push(chunk);
      return apply.call(host, chunk);
    };
    const [room, setRoom] = createSignal("a");
    let mounts = 0;
    const Page = dynamic(() => (mounts++, getRoom(room())));
    const m = mountUnderLoading(Page, {});
    await pump();
    const a = heldByRoom.get("a")![0];
    a.send({ type: "start", id: "srv", version: 1 });
    a.send({ type: "html", id: "srv", version: 1, html: articleHtml("room a") });
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("room a");

    setRoom("b");
    await pump();
    await until(() => (heldByRoom.get("b") ?? []).length === 1);
    // The old connection was the old iteration's: the consumer ended it (the
    // loop's abort broke the body), and no error was written for the death.
    expect(a.state.aborted).toBeTruthy();
    await pump();
    expect(applied.filter(c => c.type === "error")).toEqual([]);
    const b = heldByRoom.get("b")![0];
    b.send({ type: "start", id: "srv", version: 1 });
    b.send({ type: "html", id: "srv", version: 1, html: articleHtml("room b") });
    await until(() => m.div.querySelector("h1")!.textContent === "room b");
    expect(mounts).toBe(2);
    // Two addresses, two stores: the new call streamed into its own.
    expect(applied.map(c => c.id)).toContain(frameAddress("frames-live/switch", ["b"]));
    expect(m.div.textContent).not.toContain("shell-fallback");

    m.cleanup();
  });
});
