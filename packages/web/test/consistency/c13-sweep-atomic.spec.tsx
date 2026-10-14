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
 * Mechanism that carries it (frames-rulings §"The server half", C13 — the
 * sweep delimiter): the SINK's `sweep()` collects the pass's hole / attr
 * re-emissions and ships them as ONE `{ type: "ops", ops: [...] }` chunk
 * (stream face) / `sc:live` op (document face) — the chunk's edge is the
 * unit; `chunkToRecords` merges the members into one record map and
 * `FrameImpl.apply` flushes once over them (one hole pass, one
 * `#applied("morph")`, one `frame:applied`). `applyFrames.drain` and
 * `applyLiveOp` pass the unit through unchanged. The server arm — that the
 * sink emits the member for a two-binding sweep — is pinned in
 * test/server/frame-sweep-ops.spec.tsx; these arms feed the client the
 * unit as the sink now emits it.
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
  // holes as ONE `sc:live` op — `{ type: "ops", ops: [hole, hole] }`, the
  // shape frame-sink.ts's document sweep pushes for a two-binding pass.
  //
  // Was red on `next` (two separate ops): applied === ["a1|b0", "a1|b1"]
  // and frames === ["a0|b0", "a1|b0", "a1|b1"] — each op was its own
  // `host.apply` → `FrameImpl.apply` → `#flush`, a microtask apart, and
  // the wire said nothing about the two belonging together. With the unit
  // on the wire the pump hands one op to `applyLiveOp`, one write lands
  // both records, and one flush morphs both holes.
  test("(a) document face: one sweep's `ops` unit never shows one hole updated without the other", async () => {
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
    // The sweep: both re-emissions as one unit.
    page.live.push({
      type: "ops",
      ops: [
        { type: "hole", key: "lh:0", html: "a1" },
        { type: "hole", key: "lh:1", html: "b1" }
      ]
    });
    await quiesce();
    frames.sample();
    frames.stop();
    expect(holes(page.container)).toBe("a1|b1");
    expect(page.errors).toEqual([]);
    expect(torn(applied)).toEqual([]);
    expect(torn(frames.frames)).toEqual([]);
    // One flush: one announcement, one frame.
    expect(applied).toEqual(["a1|b1"]);
    expect(frames.frames).toEqual(["a0|b0", "a1|b1"]);
  });

  // Stream face: a mounted call; the sweep arrives as ONE `ops` chunk (one
  // wire line), the shape frame-sink.ts's stream sweep emits for a
  // two-binding pass.
  //
  // Was red on `next` (two `hole` chunks): applied === ["a1|b0", "a1|b1"],
  // frames === ["a0|b0", "a1|b0", "a1|b1"] — applyFrames.drain did one
  // `host.apply` per chunk with a microtask between. One chunk is one apply.
  test("(b) stream face: one sweep's `ops` chunk never shows one hole updated without the other", async () => {
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
    // The sweep: both re-emissions as one unit.
    held[0].send({
      type: "ops",
      id,
      version: 1,
      ops: [
        { type: "hole", key: "lh:0", html: "a1" },
        { type: "hole", key: "lh:1", html: "b1" }
      ]
    });
    await pump();
    frames.sample();
    frames.stop();
    expect(holes(div)).toBe("a1|b1");
    expect(torn(applied)).toEqual([]);
    expect(torn(frames.frames)).toEqual([]);
    expect(applied).toEqual(["a1|b1"]);
    expect(frames.frames).toEqual(["a0|b0", "a1|b1"]);
    held[0].send({ type: "complete", id, version: 1 });
    held[0].close();
  });

  // Catch-up: the document op log (`client.ts:liveOps`) is last-value-wins
  // per TARGET, so a unit that arrived before a boundary adopted is logged
  // by its members — a later single-hole op for one of them supersedes
  // that member alone, and the late adopter replays the latest of each.
  test("(log) an `ops` unit that arrived before a boundary adopted replays by its members, latest per hole", async () => {
    const fidA = freshFid("c13d-a");
    const fidB = freshFid("c13d-b");
    // Two boundaries on the page: A adopts first (its adoption starts the
    // channel pump, so the ops below are READ — into the log — before B
    // exists); B adopts after and can only see them through the log.
    page = bootPage(frameHtml(fidA, "<p>x</p>"));
    const other = document.createElement("div");
    other.innerHTML = frameHtml(fidB, twoHoles("a0", "b0", 20));
    document.body.appendChild(other);
    page.hy.fe("__shell", other);
    const CompA = (globalThis as any)._$SC.r(fidA);
    const CompB = (globalThis as any)._$SC.r(fidB);
    disposers.push(hydrate(() => <CompA />, page.container));
    await quiesce();
    // A unit, then one member moved again — before B adopts.
    page.live.push({
      type: "ops",
      ops: [
        { type: "hole", key: "lh:20", html: "a1" },
        { type: "hole", key: "lh:21", html: "b1" }
      ]
    });
    page.live.push({ type: "hole", key: "lh:21", html: "b2" });
    await quiesce();
    expect(holes(other)).toBe("a0|b0");
    disposers.push(
      createRoot(d => {
        <CompB />;
        return d;
      })
    );
    await quiesce();
    expect(holes(other)).toBe("a1|b2");
    expect(page.errors).toEqual([]);
  });

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
