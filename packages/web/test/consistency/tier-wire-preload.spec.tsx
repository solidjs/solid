/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The live wire tier's timing pin (frames savings pass §1, row "live wire";
 * §3 row C2). The race: a `live()` loop's first response — SSE framing,
 * the loop's wire slot on the call context — reaches the handler before
 * `@solidjs/web/frames/wire` has loaded. Lost, the response would be read
 * as a plain frame stream: no join, no supersession, no reconnect with a
 * have-list. The bound: PRELOAD-AT-CALL + AWAIT.
 *
 *  - `live()`'s decorator fires the handler's `onLive` hook at the CALL,
 *    before the first fetch: the import starts there and races only the
 *    request.
 *  - The handler's live arm AWAITS residency: with the tier gated, the
 *    response head resolves nothing — the body is not read, nothing lands
 *    in the store, the mount shows its fallback; there is no HOLD (no frame
 *    exists to hold; nothing registers under frames-rulings 3.1 — the wait
 *    is the dispatch's own await). The install lets the arm through: the
 *    body is read through the tier, the content lands, the connection is
 *    the loop's.
 *  - A live response carries `X-Frame-Tiers: wire` (the server's
 *    announcement, pinned server-side in tier-announce.spec); read through
 *    the tier, it joins the same load — one import.
 *  - A non-live call never loads the tier: a plain frame stream reads
 *    through the eager transport, and the handler's `bump` / `resume` are
 *    no-ops without it.
 *  - Reconnect through the tier: a death reconnects with the ordinal and
 *    the ledger the tier kept of what the mount shows (the have-list).
 *  - The degraded first connect, ACCEPTED: content a plain call applied
 *    before the tier was resident kept no ledger (the ledger is the
 *    tier's), so the live connect over that mount sends no have-list —
 *    and, nothing resident answering `resume`, no `Last-Event-ID` either
 *    (the server does not read the ordinal for a frame render: it compares
 *    `Last-Event-ID` to a value digest a frame answer never has) — and the
 *    server answers with a full snapshot. The live response's own root
 *    resets the ledger with the tier resident; the next reconnect names it.
 *
 * A tier, once resident, stays so for the worker: each test gates the load
 * itself (`installServerComponents({ tiers })` replaces the built-in loader)
 * and drops it between tests (`tierLoads`, the runtime's test seam).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { tierLoads } from "../../frames/src/frame-client.js";
import {
  FRAME_HAVE_HEADER,
  FRAME_TIERS_HEADER,
  decodeHaveList
} from "../../frames/src/frame-transport.js";
import { createServerReference, live } from "../../server-functions/src/client.js";
import { LAST_EVENT_ID_HEADER, frameAddress } from "../../server-functions/src/shared.js";
import {
  freshFid,
  makeHost,
  openFrameResponse,
  openLiveFrameResponse,
  pump,
  stubLiveFetch,
  until
} from "./support.js";

/** The wire tier's load, gated by the test; `release()` installs the real module. */
function gatedWire() {
  delete (tierLoads as any).wire;
  let resolve!: (m: any) => void;
  const loader = vi.fn(() => new Promise<any>(r => (resolve = r)));
  return {
    tiers: { wire: loader },
    loader,
    release: async () => resolve(await import("../../frames/src/wire-tier.js"))
  };
}
const resident = () => !!(tierLoads as any).wire?.r;

const headerOf = (init: any, name: string) => init && init.headers && init.headers[name];

/** The root: a title hole, with the server's digests. */
const rootHtml = (title: string) => `<article><h1><!--lh:1-->${title}<!--lh:/1--></h1></article>`;
const digestedRoot = (id: string, version: number, title: string, digest: string) => ({
  type: "html",
  id,
  version,
  html: rootHtml(title),
  digest,
  holes: { "lh:1": digest.slice(0, 15) + "f" }
});

/** Mount `<Loading fallback=…><Comp/></Loading>` into the body. */
function mountUnderLoading(Comp: any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span class="fb">fallback</span>}>
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

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

describe("the live wire tier — preload-at-call", () => {
  test("`live()`'s call starts the import before the first fetch; the response arm awaits residency (nothing lands, the fallback shows, no hold); the install lets it through — the announced header joins the same load, and a death reconnects with the ordinal and the have-list the tier kept", async () => {
    const gate = gatedWire();
    const fid = freshFid("tier-wire-a");
    const WIRE = `${fid}/wire`;
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const { held, urls, inits } = stubLiveFetch(WIRE, 2);
    // The server's announcement on the live response (tier-announce.spec).
    for (const h of held) h.response.headers.set(FRAME_TIERS_HEADER, "wire");
    const getRoom = live(createServerReference(fid));
    const address = frameAddress(fid, []);
    // Declaring the reference loads nothing; the CALL starts the import —
    // synchronously, before anything has iterated, before any fetch.
    expect(gate.loader).not.toHaveBeenCalled();
    const src: any = getRoom();
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(urls).toHaveLength(0);
    expect(resident()).toBe(false);
    const status: string[] = [];
    src.onstatus = (s: string) => status.push(s);
    let mounts = 0;
    const Page = dynamic(() => (mounts++, src));
    const m = mountUnderLoading(Page);
    cleanups.push(m.cleanup);
    await pump();
    // The loop connected (the live address); the response head is in. The
    // arm awaits the tier: the body is NOT read — the chunks sit in it —
    // nothing is in the store, no frame exists under the address (so there
    // is nothing to hold and nothing registered), the mount shows its
    // fallback, the loop has not been told "connected".
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/live/");
    held[0].send({ type: "start", id: WIRE, version: 1 });
    held[0].send(digestedRoot(WIRE, 1, "v1", "a000000000000001"));
    await pump();
    expect(resident()).toBe(false);
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(host.get(address)).toBeUndefined();
    expect(m.div.querySelector(".fb")).not.toBeNull();
    expect(m.div.querySelector("h1")).toBeNull();
    expect(status).toEqual([]);

    // The install: the arm proceeds through the tier — the body is read
    // (the loop's event-stream reader), the version moves, the content
    // lands, the loop is connected. The header's `wire` joined the load
    // already running: one import.
    await gate.release();
    await until(() => m.div.querySelector("h1") !== null, 3000);
    expect(resident()).toBe(true);
    expect(gate.loader).toHaveBeenCalledTimes(1);
    expect(m.div.querySelector("h1")!.textContent).toBe("v1");
    expect(m.div.querySelector(".fb")).toBeNull();
    expect(mounts).toBe(1);
    expect(status).toEqual(["connected"]);
    // A first connect over nothing shown: no position, no have-list.
    expect(headerOf(inits[0], LAST_EVENT_ID_HEADER)).toBeUndefined();
    expect(headerOf(inits[0], FRAME_HAVE_HEADER)).toBeUndefined();

    // Death → the reconnect goes through the tier: the ordinal, and the
    // have-list of what the mount shows — kept by the tier at apply time.
    const h1 = m.div.querySelector("h1")!;
    held[0].close();
    await until(() => urls.length === 2, 3000);
    expect(status.slice(0, 2)).toEqual(["connected", "reconnecting"]);
    expect(headerOf(inits[1], LAST_EVENT_ID_HEADER)).toBe("1");
    expect(decodeHaveList(headerOf(inits[1], FRAME_HAVE_HEADER))).toEqual({
      "": "a000000000000001",
      "lh:1": "a00000000000000f"
    });
    // The content stood through the backoff; the reconnect morphs in place.
    expect(m.div.querySelector("h1")).toBe(h1);
    held[1].send({ type: "start", id: WIRE, version: 1 });
    held[1].send({
      type: "hole",
      id: WIRE,
      version: 1,
      key: "lh:1",
      html: "v2",
      digest: "a000000000000002"
    });
    await until(() => h1.textContent === "v2", 3000);
    expect(m.div.querySelector("h1")).toBe(h1);
    expect(mounts).toBe(1);
    held[1].send({ type: "complete", id: WIRE, version: 1 });
    held[1].close();
    await until(() => status.includes("closed"), 3000);
  }, 10000);

  test("a non-live call never loads the tier: a plain frame stream reads through the eager transport, and a refetch's bump has no connection to cancel", async () => {
    const gate = gatedWire();
    const fid = freshFid("tier-wire-b");
    const WIRE = `${fid}/wire`;
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const responses = [openFrameResponse(WIRE), openFrameResponse(WIRE)];
    let calls = 0;
    vi.stubGlobal("fetch", async () => responses[calls++].response);
    const getPanel = createServerReference(fid);
    const [tick, setTick] = createSignal(0);
    const Page = dynamic(() => (tick(), getPanel() as any));
    const m = mountUnderLoading(Page);
    cleanups.push(m.cleanup);
    await pump();
    expect(calls).toBe(1);
    responses[0].send({ type: "start", id: WIRE, version: 1 });
    responses[0].send(digestedRoot(WIRE, 1, "plain", "b000000000000001"));
    responses[0].send({ type: "complete", id: WIRE, version: 1 });
    responses[0].close();
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("plain");
    expect(gate.loader).not.toHaveBeenCalled();
    expect(resident()).toBe(false);
    // A refetch of the same call: the next version — `bump` runs with the
    // tier absent (nothing to cancel), the morph lands.
    const h1 = m.div.querySelector("h1")!;
    setTick(1);
    await pump();
    expect(calls).toBe(2);
    responses[1].send({ type: "start", id: WIRE, version: 1 });
    responses[1].send(digestedRoot(WIRE, 1, "plain-2", "b000000000000002"));
    responses[1].send({ type: "complete", id: WIRE, version: 1 });
    responses[1].close();
    await until(() => h1.textContent === "plain-2", 3000);
    expect(m.div.querySelector("h1")).toBe(h1);
    expect(gate.loader).not.toHaveBeenCalled();
    expect(resident()).toBe(false);
  });

  test("the degraded first connect (accepted): content a plain call applied before the tier was resident kept no ledger — the live connect sends no have-list and no position (a full snapshot); the live response's own root resets the ledger, and the reconnect names it", async () => {
    const gate = gatedWire();
    const fid = freshFid("tier-wire-c");
    const WIRE = `${fid}/wire`;
    const { host } = makeHost();
    installServerComponents(host, { tiers: gate.tiers });
    const address = frameAddress(fid, []);
    // One fetch stub for the plain call, then the loop's two connects.
    const plain = openFrameResponse(WIRE);
    const lives = [openLiveFrameResponse(WIRE), openLiveFrameResponse(WIRE)];
    const urls: string[] = [];
    const inits: any[] = [];
    vi.stubGlobal("fetch", async (input: any, init: any) => {
      urls.push(typeof input === "string" ? input : input.url);
      inits.push(init);
      const n = urls.length;
      if (n === 1) return plain.response;
      const next = lives[n - 2];
      if (!next) throw new Error(`unexpected fetch #${n}`);
      if (init && init.signal)
        init.signal.addEventListener("abort", () => next.abort(init.signal.reason), { once: true });
      return next.response;
    });
    // The plain call: its root carries the server's digests, applied with
    // the tier ABSENT — the ledger is the tier's, so nothing kept it.
    const getPanel = createServerReference(fid);
    const Plain = dynamic(() => getPanel() as any);
    const m = mountUnderLoading(Plain);
    cleanups.push(m.cleanup);
    await pump();
    expect(urls).toHaveLength(1);
    plain.send({ type: "start", id: WIRE, version: 1 });
    plain.send(digestedRoot(WIRE, 1, "plain", "c000000000000001"));
    plain.send({ type: "complete", id: WIRE, version: 1 });
    plain.close();
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("plain");
    expect(gate.loader).not.toHaveBeenCalled();
    expect(host.get(address)).toBeDefined();

    // A `live()` call of the same function (the same address): the import
    // starts at the call; the first connect asks `resume` with the tier not
    // resident — nothing answers: no have-list, no position. Degraded (the
    // server renders a full snapshot where a conditional one was possible),
    // not wrong.
    const getRoom = live(createServerReference(fid));
    const src: any = getRoom();
    expect(gate.loader).toHaveBeenCalledTimes(1);
    const status: string[] = [];
    src.onstatus = (s: string) => status.push(s);
    const Live = dynamic(() => src);
    const m2 = mountUnderLoading(Live);
    cleanups.push(m2.cleanup);
    await pump();
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("/live/");
    expect(headerOf(inits[1], FRAME_HAVE_HEADER)).toBeUndefined();
    expect(headerOf(inits[1], LAST_EVENT_ID_HEADER)).toBeUndefined();

    // The full snapshot arrives; the install lets the arm read it. Its root
    // resets the ledger — with the tier resident now, it is kept.
    lives[0].send({ type: "start", id: WIRE, version: 1 });
    lives[0].send(digestedRoot(WIRE, 1, "live", "c000000000000002"));
    await gate.release();
    await until(() => m2.div.querySelector("h1") !== null, 3000);
    expect(resident()).toBe(true);
    expect(m2.div.querySelector("h1")!.textContent).toBe("live");
    // The plain mount is bound to the same address: the store moved to the
    // live response's version and it morphed too.
    expect(m.div.querySelector("h1")!.textContent).toBe("live");
    expect(status).toEqual(["connected"]);

    // Death → the reconnect names the ordinal (the address's second
    // version) and the ledger the live root seeded.
    lives[0].close();
    await until(() => urls.length === 3, 3000);
    expect(headerOf(inits[2], LAST_EVENT_ID_HEADER)).toBe("2");
    expect(decodeHaveList(headerOf(inits[2], FRAME_HAVE_HEADER))).toEqual({
      "": "c000000000000002",
      "lh:1": "c00000000000000f"
    });
    lives[1].send({ type: "start", id: WIRE, version: 1 });
    lives[1].send({ type: "complete", id: WIRE, version: 1 });
    lives[1].close();
    await until(() => status.includes("closed"), 3000);
  }, 10000);
});
