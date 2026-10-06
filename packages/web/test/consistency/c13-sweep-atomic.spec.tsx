/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C13 — one sweep, one frame.
 *
 * "Live-hole and attr-hole re-emissions produced by one server sweep become
 * visible together: no observable point shows one hole of the sweep updated
 * while a sibling hole of the same sweep still shows the previous value."
 *
 * Mechanism meant to carry it: frames/src/frame-transport.ts
 * `applyFrames.drain` (one `host.apply` per framed chunk, an `await`
 * between), frames/src/client.ts `pumpLiveChannel` (the document channel is
 * a ReadableStream read one op at a time), frames/src/frame-client.ts
 * `FrameImpl.#flush` (the hole pass morphs every applicable hole record of
 * the store) and `#applied` (a `frame:applied` event per hole). The wire
 * carries no sweep delimiter: the server coalesces per BINDING ("at most
 * one emission per binding per flush"), never per sweep.
 *
 * Observation points: a `frame:applied` listener (the runtime's own
 * announcement of a landed morph) and a MutationObserver (a microtask
 * checkpoint — what a user-visible paint could show). A "torn" frame is one
 * where exactly one of the two holes moved.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Loading } from "solid-js";
import { dynamic, hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import {
  bootPage,
  frameHtml,
  freshFid,
  holeHtml,
  makeHost,
  pump,
  quiesce,
  stubHeldFetch,
  watchFrames,
  type Page
} from "./support.js";

/** The two holes' text, `a|b`. */
const holes = (root: ParentNode) =>
  [...root.querySelectorAll("p")].map(p => p.textContent).join("|");
/** The sweep's content: hole `n` shows `a`, hole `n + 1` shows `b`. The
 *  document live-op log (`client.ts:liveOps`) is module state keyed by hole
 *  id and replays to every later adoption in this worker, so each document
 *  page in this file uses hole ids of its own. */
const twoHoles = (a: string, b: string, n = 0) =>
  `<p>${holeHtml(n, a)}</p><p>${holeHtml(n + 1, b)}</p>`;
/** Every frame the observers recorded in which exactly one hole moved. */
const torn = (frames: string[]) => frames.filter(f => f === "a1|b0" || f === "a0|b1");

let page: Page | undefined;
const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  await page?.cleanup();
  page = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  document.body.innerHTML = "";
});

describe("C13 — one sweep, one frame", () => {
  // Document face: an adopted boundary; the server's sweep re-emits both
  // holes as two `sc:live` ops written in one synchronous span.
  //
  // Observed on `next`: applied === ["a1|b0", "a1|b1"] and frames ===
  // ["a0|b0", "a1|b0", "a1|b1"] — the first hole lands and is announced
  // (and is visible at a microtask checkpoint) while the second still
  // shows b0. Expected: no "a1|b0" anywhere. Where it goes wrong: the
  // document channel is a ReadableStream of ops read one at a time
  // (client.ts:pumpLiveChannel — `reader.read().then(op => applyLiveOp(op);
  // pump())`), so each op is its own `host.apply` → `FrameImpl.apply` →
  // `#flush`, whose hole pass morphs that one hole (`#applyHole`) and fires
  // `#applied(version, "morph")` for it; the second op is a microtask later.
  // Nothing on the wire says the two ops belong to one sweep (the server
  // coalesces per binding, not per sweep), so the client has no unit larger
  // than one op to make atomic.
  test.fails(
    "(a) document face: two `sc:live` ops of one sweep never show one hole updated without the other",
    async () => {
      const fid = freshFid("c13a");
      page = bootPage(frameHtml(fid, twoHoles("a0", "b0", 0)));
      const Comp = (globalThis as any)._$SC.r(fid);
      const applied: string[] = [];
      page.container.addEventListener("frame:applied", () => applied.push(holes(page!.container)));
      const dispose = hydrate(() => <Comp />, page.container);
      disposers.push(dispose);
      await quiesce();
      expect(holes(page.container)).toBe("a0|b0");
      applied.length = 0;
      const frames = watchFrames(page.container, () => holes(page!.container));
      // The sweep: both re-emissions in one synchronous span.
      page.live.push({ type: "hole", key: "lh:0", html: "a1" });
      page.live.push({ type: "hole", key: "lh:1", html: "b1" });
      await quiesce();
      frames.sample();
      frames.stop();
      expect(holes(page.container)).toBe("a1|b1");
      expect(page.errors).toEqual([]);
      expect(torn(applied)).toEqual([]);
      expect(torn(frames.frames)).toEqual([]);
    }
  );

  // Stream face: a mounted call; the sweep's two `hole` chunks are enqueued
  // back to back into one body (one network write).
  //
  // Observed on `next`: applied === ["a1|b0", "a1|b1"], frames === ["a0|b0",
  // "a1|b0", "a1|b1"]. Expected: no torn pair. Where it goes wrong:
  // frame-transport.ts:applyFrames.drain reads one framed chunk per
  // `await reader.next()` and calls `host.apply(chunk)` per chunk — each
  // `hole` chunk is a separate `FrameImpl.apply` → `#flush` → hole pass →
  // `#applied("morph")`, with a microtask between the two; a MutationObserver
  // fires in that gap. One body write is not one apply.
  test.fails(
    "(b) stream face: two hole chunks of one sweep never show one hole updated without the other",
    async () => {
      const id = freshFid("c13b");
      installServerComponents(makeHost().host);
      const { held } = stubHeldFetch([id]);
      const getRoom = createServerReference(id);
      const Page = dynamic(() => getRoom() as any);
      let div!: HTMLDivElement;
      const dispose = createRoot(d => {
        <div ref={div}>
          <Loading fallback={<span>fallback</span>}>
            <Page />
          </Loading>
        </div>;
        document.body.appendChild(div);
        return d;
      });
      disposers.push(dispose);
      const applied: string[] = [];
      div.addEventListener("frame:applied", () => applied.push(holes(div)));
      await pump();
      held[0].send({ type: "start", id, version: 1 });
      held[0].send({ type: "html", id, version: 1, html: twoHoles("a0", "b0") });
      await pump();
      expect(holes(div)).toBe("a0|b0");
      applied.length = 0;
      const frames = watchFrames(div, () => holes(div));
      // The sweep: both re-emissions in one burst.
      held[0].send({ type: "hole", id, version: 1, key: "lh:0", html: "a1" });
      held[0].send({ type: "hole", id, version: 1, key: "lh:1", html: "b1" });
      await pump();
      frames.sample();
      frames.stop();
      expect(holes(div)).toBe("a1|b1");
      expect(torn(applied)).toEqual([]);
      expect(torn(frames.frames)).toEqual([]);
      held[0].send({ type: "complete", id, version: 1 });
      held[0].close();
    }
  );

  // Control: a sweep that touches ONE hole is trivially atomic — the single
  // `frame:applied` and the single frame both show the new value, and the
  // untouched sibling never moves.
  test("(control) a one-hole sweep lands in one frame on both faces", async () => {
    const fid = freshFid("c13c");
    page = bootPage(frameHtml(fid, twoHoles("a0", "b0", 10)));
    const Comp = (globalThis as any)._$SC.r(fid);
    const applied: string[] = [];
    page.container.addEventListener("frame:applied", () => applied.push(holes(page!.container)));
    const dispose = hydrate(() => <Comp />, page.container);
    disposers.push(dispose);
    await quiesce();
    applied.length = 0;
    const frames = watchFrames(page.container, () => holes(page!.container));
    page.live.push({ type: "hole", key: "lh:10", html: "a1" });
    await quiesce();
    frames.sample();
    frames.stop();
    expect(applied).toEqual(["a1|b0"]);
    expect(frames.frames).toEqual(["a0|b0", "a1|b0"]);
    expect(page.errors).toEqual([]);
  });
});
