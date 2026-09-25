/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The document face of a live server component (Stage 8 B3) when the call's
 * ARGUMENTS change after adoption — the room demo's shape: the page renders
 * `room("a")` with no identity (the browser mints one), and the client's
 * source switches to `room("a", me)` once it has one. Its own file: the
 * frames client's boundary index and claim set are module state, one page
 * per module instance (see frame-live-document.spec.tsx for the replay
 * modes).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference, live } from "../../server-functions/src/client.js";
import { frameAddress } from "../../server-functions/src/shared.js";
import { makeHost, pump, stubLiveFetch, until } from "../lifecycle-matrix/harness.js";
import { ARGS, fidFor, makeApp } from "../harness/frame-live-document.jsx";
import { applyChunk, drain, loadArtifact, roomHtml } from "./frame-live-document-helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any)._$HY;
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

describe("document face — live server component, arguments switched after adoption", () => {
  // The document's call and the standing call differ: the page rendered
  // `room("a")` (no identity yet — the browser mints one), the client's
  // source switches to `room("a", me)` once it has one. The switch is a
  // kept resolution (same function, new address) — the adopted instance
  // follows the new address — and every reconnect after it must keep the
  // instance THERE. `dynamic`'s memo still holds the document's binding (a
  // kept resolution never replaces the memo's value), so the reconnect's
  // re-yield of the standing binding compares against the FIRST address;
  // read as "the other address is incoming", it swings the frame back to
  // the document's store and the reconnect's render lands where nothing is
  // bound (the room demo's presence went blank on the first chaos).
  test("switched: a reconnect after the call's arguments changed keeps the instance at the new address", async () => {
    const FID = fidFor("switched");
    const { shell, rest } = loadArtifact("frame-live-document-switched");
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { host } = makeHost();
    installServerComponents(host);
    const { held, urls } = stubLiveFetch(FID, 3);

    const room = live(createServerReference(FID));
    const status: string[] = [];
    const [me, setMe] = createSignal<string | null>(null);
    const App = makeApp(() => {
      const identity = me();
      const src: any = identity === null ? room(...ARGS) : room(...ARGS, identity);
      src.onstatus = (s: string) => status.push(s);
      return src;
    });

    applyChunk(container, shell, true);
    applyChunk(container, rest, false);
    const dispose = hydrate(() => <App />, container);
    flush();
    await drain();

    const frameEl = container.querySelector(`solid-frame[data-fid="${FID}"]`)!;
    const input = container.querySelector<HTMLInputElement>("input.draft")!;
    expect(frameEl).not.toBeNull();
    expect(container.querySelector("h1")!.textContent).toBe("room v1");
    const documentAddress = frameAddress(FID, ARGS);
    const standingAddress = frameAddress(FID, [...ARGS, "me"]);
    expect(standingAddress).not.toBe(documentAddress);

    // The takeover connects the document's call first.
    await until(() => urls.length === 1);
    await until(() => status.includes("connected"));

    // The browser minted an identity: the source switches calls. The old
    // iteration ends (its connection severed), the new one connects at the
    // standing address, and the instance FOLLOWS — same frame, re-bound.
    setMe("me");
    flush();
    await until(() => urls.length === 2);
    held[1].send({ type: "start", id: standingAddress, version: 1 });
    held[1].send({ type: "html", id: standingAddress, version: 1, html: roomHtml("room v2") });
    await until(() => container.querySelector("h1")!.textContent === "room v2");
    expect(container.querySelector("solid-frame")).toBe(frameEl);
    expect(frameEl.getAttribute("data-fid")).toBe(standingAddress);
    expect(container.querySelector("input.draft")).toBe(input);

    input.value = "draft in progress";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flush();

    // Death → reconnect at the standing address: the instance stays bound
    // there and the reconnect's render is what shows.
    held[1].close();
    await until(() => status.filter(s => s === "reconnecting").length === 1);
    await until(() => urls.length === 3);
    held[2].send({ type: "start", id: standingAddress, version: 1 });
    held[2].send({ type: "html", id: standingAddress, version: 1, html: roomHtml("room v3") });
    await until(() => container.querySelector("h1")!.textContent === "room v3");
    expect(frameEl.getAttribute("data-fid")).toBe(standingAddress);
    expect(container.querySelector("solid-frame")).toBe(frameEl);
    expect(container.querySelector("input.draft")).toBe(input);
    expect(input.value).toBe("draft in progress");
    // The switch and the reconnect are wire events only: nothing between
    // them showed the document's content again.
    expect(container.querySelector("main")!.textContent).not.toContain("room v1");

    dispose();
    await pump();
    expect(status.at(-1)).toBe("closed");
    container.remove();
  });
});
