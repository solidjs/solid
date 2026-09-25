/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Frames consume `live` (Stage 8, slice B3): the document's answer for a
// live call, read outside any hydration scope. Its own file: the frames
// client indexes the page's boundaries once per module instance (extended
// only by reveals), so this page must be the module's first.
import { describe, expect, test } from "vitest";
import { createRoot, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import { createServerReference, live } from "../server-functions/src/client.js";
import { frameAddress } from "../server-functions/src/shared.js";
import { makeHost, pump, stubLiveFetch, until } from "./lifecycle-matrix/harness.js";

function articleHtml(title: string) {
  return (
    `<article><h1>${title}</h1>` +
    "<ul><!--slot:composer#0:start--><!--slot:composer#0:end--></ul>" +
    "</article>"
  );
}
describe("frames consume live: the document's answer outside a hydration scope", () => {
  // The page carries the call's boundary but no hydration scope is open
  // around the reader (a client-only mount after the page loaded, a late
  // island): nothing adopts the local answer FOR the iteration, so the
  // iteration does it itself — yields the adopted binding first (the
  // markup is the value; no request, no status), then connects at the live
  // address; the connection resolves the same binding and morphs in place.
  test("a client-only reader of a call the page is showing adopts first, then connects once", async () => {
    const FID = "frames-live/showing";
    const container = document.createElement("div");
    container.innerHTML =
      `<solid-frame data-fid="${FID}" style="display:contents">` +
      articleHtml("document") +
      "</solid-frame>";
    document.body.appendChild(container);
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {}, done: true };
    const { host } = makeHost();
    installServerComponents(host);
    const { held, urls } = stubLiveFetch("srv", 1);
    const getRoom = live(createServerReference(FID));
    const src: any = getRoom("a");
    const status: string[] = [];
    src.onstatus = (s: string) => status.push(s);

    let mounts = 0;
    const Page = dynamic(() => (mounts++, src));
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>shell-fallback</span>}>
          <Page />
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    await pump();
    // Adopted: the document's element (where the server put it) is the
    // mount's, with its markup; the reader is not on its fallback.
    const frameEl = container.querySelector(`solid-frame[data-fid="${FID}"]`)!;
    expect(container.querySelectorAll("solid-frame").length).toBe(1);
    expect(container.querySelector("h1")!.textContent).toBe("document");
    const h1 = container.querySelector("h1")!;
    expect(div.textContent).not.toContain("shell-fallback");
    // ...and connected once, after the adoption, at the live address.
    await until(() => urls.length === 1);
    expect(urls[0]).toContain("/live/");
    await until(() => status.includes("connected"));
    expect(status).toEqual(["connected"]);

    const address = frameAddress(FID, ["a"]);
    held[0].send({ type: "start", id: address, version: 1 });
    held[0].send({ type: "html", id: address, version: 1, html: articleHtml("live") });
    await until(() => container.querySelector("h1")!.textContent === "live");
    expect(container.querySelector("solid-frame")).toBe(frameEl);
    expect(container.querySelector("h1")).toBe(h1);
    expect(mounts).toBe(1);
    expect(div.textContent).not.toContain("shell-fallback");

    dispose();
    container.remove();
    delete (globalThis as any)._$HY;
    delete (globalThis as any)._$SC;
  });
});
