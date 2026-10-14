/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The adopted (document) face of frames-rulings 3.3 / A7: a frame the page
 * carried is one async value outward too. Its first landing is the
 * document's and never errors, but an error AFTER it — the escaped server
 * error the document face delivers as an `sc:live` error op (A6's C12 (c3)
 * arm), or any `:error` written at the address — is the L2 "errored flight
 * after a landing" case: the mount's address-source reader (the effect
 * `adoptBoundary` keeps for the switch's pending) throws it to the nearest
 * client `<Errored>`, and the boundary's `reset` re-asks the call the
 * document answered (recorded at the intercept), over the wire.
 *
 * A mount placed WITHOUT a binding (`_$SC.r(fid)` used directly as a
 * component) has no such reader: its frame keeps the record only — the
 * direct-placeholder gap, recorded under 3.3.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Errored, Loading, resetErrorHalt } from "solid-js";
import { dynamic, hydrate } from "@solidjs/web";
import { createServerReference } from "../../server-functions/src/client.js";
import { frameAddress } from "../../server-functions/src/shared.js";
import {
  bootPage,
  frameHtml,
  freshFid,
  heldStream,
  quiesce,
  type Page
} from "../consistency/support.js";

let page: Page | undefined;
const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  await page?.cleanup();
  page = undefined;
  resetErrorHalt();
});

describe("adopted frame: an error after the document's landing throws outward; reset re-asks", () => {
  test("a `dynamic` mount over the document's element: the sc:live error op errors the mount, the <Errored> shows it, reset() fetches and the new content lands in place", async () => {
    const fid = freshFid("adopt-err");
    page = bootPage(frameHtml(fid, "<h1>doc</h1>"));
    const address = frameAddress(fid, [1]);
    // The re-ask goes to the wire: one held frame response for it.
    const wire = heldStream(fid);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: any, init: any) => {
      calls.push(`${init?.method} ${JSON.parse(String(init?.body))[0]}`);
      return wire.response;
    });
    const getX = createServerReference(fid);
    // The call is answered by the page (the intercept); the record of it
    // is what a later reset re-asks.
    const Site = dynamic(() => getX(1) as any);
    let resetFn: (() => void) | undefined;
    disposers.push(
      hydrate(
        () => (
          <Errored
            fallback={(err, reset) => {
              resetFn = reset;
              return <em class="err">{String(err())}</em>;
            }}
          >
            <Loading fallback={<span>fallback</span>}>
              <Site />
            </Loading>
          </Errored>
        ),
        page.container
      )
    );
    await quiesce();
    const el = page.container.querySelector("solid-frame")!;
    expect(el).not.toBeNull();
    expect(page.container.querySelector("h1")!.textContent).toBe("doc");
    expect(calls).toEqual([]);

    // The escaped server error, as the document face delivers it: the
    // frame's `:error`, after its landing.
    page.live.push({ type: "error", fid, error: "boom" });
    await quiesce();
    await quiesce();
    expect((page.host.get(address) as any).error).toBe("boom");
    expect(page.container.querySelector("em.err")!.textContent).toBe("boom");
    expect(page.container.querySelector("h1")).toBeNull();
    expect(calls).toEqual([]);

    // `reset` re-asks the call the document answered: the same function,
    // the same args, over the wire; the response lands in the SAME element
    // (the mount stood behind the fallback) and the boundary shows it.
    resetFn!();
    await quiesce();
    expect(calls).toEqual(["POST 1"]);
    wire.send({ type: "start", id: fid, version: 1 });
    wire.send({ type: "html", id: fid, version: 1, html: "<h1>re-asked</h1>" });
    wire.send({ type: "complete", id: fid, version: 1 });
    wire.close();
    await quiesce();
    await quiesce();
    expect(page.container.querySelector("em.err")).toBeNull();
    expect(page.container.querySelector("solid-frame")).toBe(el);
    expect(page.container.querySelector("h1")!.textContent).toBe("re-asked");
    expect((page.host.get(address) as any).error).toBeUndefined();
  });

  test("the direct-placeholder gap: a mount placed without a binding keeps the record only (no reader to throw it)", async () => {
    const fid = freshFid("adopt-err-bare");
    page = bootPage(frameHtml(fid, "<h1>doc</h1>"));
    const Comp = (globalThis as any)._$SC.r(fid);
    disposers.push(
      hydrate(
        () => (
          <Errored fallback={<em class="err">caught</em>}>
            <Comp />
          </Errored>
        ),
        page.container
      )
    );
    await quiesce();
    page.live.push({ type: "error", fid, error: "boom" });
    await quiesce();
    await quiesce();
    expect((page.host.get(fid) as any).error).toBe("boom");
    expect(page.container.querySelector("em.err")).toBeNull();
    expect(page.container.querySelector("h1")!.textContent).toBe("doc");
  });
});
