/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The client half of the conditional reconnect (Stage 8 B4, RFC 11 §9.5
// Resume request / Hole hashes): a mount keeps a ledger of the server's
// digests for what it SHOWS — reset by a root apply, extended at each
// reveal, kept current by each hole apply — and the live loop's reconnect
// carries the address's version ordinal as `Last-Event-ID` and the ledger
// as the have-list header (digests are opaque 16-hex strings — stand-ins
// here). Never derived from the DOM; a fragment received
// but not yet revealed is not claimed.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import {
  FRAME_HAVE_BUDGET,
  FRAME_HAVE_HEADER,
  decodeHaveList,
  encodeHaveList
} from "../frames/src/frame-transport.js";
import { createServerReference, live } from "../server-functions/src/client.js";
import { LAST_EVENT_ID_HEADER } from "../server-functions/src/shared.js";
import { makeHost, pump, stubLiveFetch, until } from "./lifecycle-matrix/harness.js";

const ID = "frames-live-resume/room";

/** The root: a live title hole and a pending boundary with its fallback. */
const rootHtml =
  "<article><h1><!--lh:1-->v1<!--lh:/1--></h1>" +
  '<template id="pl-0"></template><p class="fb">loading</p><!--pl-0-->' +
  "</article>";
const bodyHtml = '<p class="body"><!--lh:0-->B1<!--lh:/0--></p>';

function mountUnderLoading(Comp: any) {
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

const headerOf = (init: any, name: string) => init && init.headers && init.headers[name];

afterEach(() => vi.unstubAllGlobals());

describe("have-list encoding", () => {
  test("round-trips keys and digests; the root's key is empty", () => {
    const have = { "": "0123456789abcdef", "lh:0": "fedcba9876543210", "pl-0": "0000000000000001" };
    const text = encodeHaveList(have)!;
    expect(text).toBe("=0123456789abcdef,lh:0=fedcba9876543210,pl-0=0000000000000001");
    expect(decodeHaveList(text)).toEqual(have);
  });

  test("an empty list, a malformed entry, and an over-budget list", () => {
    expect(encodeHaveList({})).toBeUndefined();
    expect(decodeHaveList("")).toBeUndefined();
    expect(decodeHaveList(null)).toBeUndefined();
    // Malformed entries are skipped, never trusted.
    expect(decodeHaveList("lh:0=nothex,lh:1=0123456789abcdef")).toEqual({
      "lh:1": "0123456789abcdef"
    });
    const big: Record<string, string> = {};
    for (let i = 0; i < FRAME_HAVE_BUDGET / 20; i++) big["lh:" + i] = "0123456789abcdef";
    expect(encodeHaveList(big)).toBeUndefined();
  });
});

describe("the mount's ledger and the resume request", () => {
  test("first connect carries nothing; a reconnect carries the ordinal and what the mount shows", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const { held, urls, inits } = stubLiveFetch(ID, 3);
    const getRoom = live(createServerReference(ID));
    const src: any = getRoom();
    const status: string[] = [];
    src.onstatus = (s: string) => status.push(s);
    const Page = dynamic(() => src);
    const m = mountUnderLoading(Page);
    await pump();
    expect(urls).toHaveLength(1);
    // Nothing shown yet: no position, no have-list.
    expect(headerOf(inits[0], LAST_EVENT_ID_HEADER)).toBeUndefined();
    expect(headerOf(inits[0], FRAME_HAVE_HEADER)).toBeUndefined();

    // The first stream: root (with its skeleton digest and hole map), the
    // boundary's fragment + reveal, then a live re-emission of the title.
    held[0].send({ type: "start", id: ID, version: 1 });
    held[0].send({
      type: "html",
      id: ID,
      version: 1,
      html: rootHtml,
      digest: "a000000000000001",
      holes: { "lh:1": "a000000000000002" }
    });
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("v1");
    const frame: any = host.get(ID);
    expect(frame.have()).toEqual({ "": "a000000000000001", "lh:1": "a000000000000002" });

    // A fragment RECEIVED but not revealed is not claimed...
    held[0].send({
      type: "fragment",
      id: ID,
      version: 1,
      key: "0",
      html: bodyHtml,
      digest: "a000000000000003",
      holes: { "lh:0": "a000000000000004" }
    });
    await pump();
    expect(frame.have()).toEqual({ "": "a000000000000001", "lh:1": "a000000000000002" });
    // ...until its reveal lands it in the DOM.
    held[0].send({ type: "reveal", id: ID, version: 1, keys: ["0"] });
    await pump();
    expect(m.div.querySelector(".body")!.textContent).toBe("B1");
    expect(frame.have()).toEqual({
      "": "a000000000000001",
      "lh:1": "a000000000000002",
      "0": "a000000000000003",
      "lh:0": "a000000000000004"
    });
    // A hole re-emission moves its entry.
    held[0].send({
      type: "hole",
      id: ID,
      version: 1,
      key: "lh:1",
      html: "v2",
      digest: "a000000000000005"
    });
    await pump();
    expect(m.div.querySelector("h1")!.textContent).toBe("v2");
    expect(frame.have()["lh:1"]).toBe("a000000000000005");

    // Death → the reconnect names the version ordinal and the ledger.
    held[0].close();
    await until(() => urls.length === 2, 3000);
    expect(headerOf(inits[1], LAST_EVENT_ID_HEADER)).toBe("1");
    expect(decodeHaveList(headerOf(inits[1], FRAME_HAVE_HEADER))).toEqual({
      "": "a000000000000001",
      "lh:1": "a000000000000005",
      "0": "a000000000000003",
      "lh:0": "a000000000000004"
    });

    // A conditional answer: no root, one hole. The content stands (no
    // fallback), the ledger follows the hole, and the next reconnect names
    // the new ordinal and the moved entry.
    const h1 = m.div.querySelector("h1")!;
    held[1].send({ type: "start", id: ID, version: 1 });
    held[1].send({
      type: "hole",
      id: ID,
      version: 1,
      key: "lh:0",
      html: "B2",
      digest: "a000000000000006"
    });
    await until(() => m.div.querySelector(".body")!.textContent === "B2");
    expect(m.div.querySelector("h1")).toBe(h1);
    expect(m.div.textContent).not.toContain("loading");
    expect(m.div.textContent).not.toContain("shell-fallback");
    held[1].close();
    await until(() => urls.length === 3, 3000);
    expect(headerOf(inits[2], LAST_EVENT_ID_HEADER)).toBe("2");
    expect(decodeHaveList(headerOf(inits[2], FRAME_HAVE_HEADER))).toEqual({
      "": "a000000000000001",
      "lh:1": "a000000000000005",
      "0": "a000000000000003",
      "lh:0": "a000000000000006"
    });
    held[2].send({ type: "start", id: ID, version: 1 });
    held[2].send({ type: "complete", id: ID, version: 1 });
    held[2].close();
    await until(() => status.includes("closed"));
    m.cleanup();
  }, 10000);

  test("a root without digests leaves no ledger: the reconnect carries the ordinal alone", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const { held, urls, inits } = stubLiveFetch(ID + "-plain", 2);
    const getRoom = live(createServerReference(ID + "-plain"));
    const src: any = getRoom();
    const Page = dynamic(() => src);
    const m = mountUnderLoading(Page);
    await pump();
    held[0].send({ type: "start", id: ID + "-plain", version: 1 });
    held[0].send({ type: "html", id: ID + "-plain", version: 1, html: "<article>plain</article>" });
    await pump();
    expect((host.get(ID + "-plain") as any).have()).toBeUndefined();
    held[0].close();
    await until(() => urls.length === 2, 3000);
    expect(headerOf(inits[1], LAST_EVENT_ID_HEADER)).toBe("1");
    expect(headerOf(inits[1], FRAME_HAVE_HEADER)).toBeUndefined();
    held[1].send({ type: "start", id: ID + "-plain", version: 1 });
    held[1].send({ type: "complete", id: ID + "-plain", version: 1 });
    held[1].close();
    await pump();
    m.cleanup();
  }, 10000);
});
