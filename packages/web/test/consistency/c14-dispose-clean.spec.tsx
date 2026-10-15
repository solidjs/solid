/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C14 — disposal leaves nothing.
 *
 * "Disposing a mount — during hydration, during a `{$ref}`/record/boundary
 * wait, or mid-stream — leaves no frame registered on the host, no live
 * applier, no boundary waiter, no pending timer, and no later chunk, record
 * or reveal touches the DOM or invokes a fill."
 *
 * Mechanism meant to carry it: frames/src/frame-client.ts `FrameImpl.dispose`
 * (unregister first, `#recordRefresh` cleared, slot cleanups, record
 * hygiene), `createFrameHost.unregister`, frames/src/client.ts
 * `adoptBoundary`'s `onCleanup` (live applier removed, `fr` unsubscribed,
 * `frame.dispose()`), `documentBoundary`'s `live` latch over the shared
 * arrival wait, `followAddress.drop`, `slotsFor`'s per-occurrence fill
 * owners (`ctx.onCleanup`). Fragment ownership needs no release: it is
 * geometry (`_$HY.fa` reads the placeholder's enclosing `data-fid` element
 * in the live document), so a disposed boundary's element leaving the
 * document is what retires it — arm (e) pins the attached case.
 *
 * Each arm disposes at a different hold, then delivers EVERYTHING the
 * disposed mount was waiting for and asserts nothing moved: the fill's
 * invocation count, the DOM text, the `frame:applied` announcements, and —
 * where a mount can follow — that a fresh mount is unaffected by the dead one.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemo, createRoot, Loading, onCleanup } from "solid-js";
import { dynamic, hydrate } from "@solidjs/web";
import { installServerComponents } from "../../frames/src/client.js";
import { createServerReference } from "../../server-functions/src/client.js";
import {
  bootPage,
  createDataSource,
  fillHtml,
  frameHtml,
  freshFid,
  holeHtml,
  makeHost,
  microtasks,
  placeholderHtml,
  pump,
  quiesce,
  slotRange,
  stubHeldFetch,
  type Page
} from "./support.js";

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

/** The contract's instrumented fill: counts invocations, records every
 *  value its prop read yields, and reports its own cleanup. The element is
 *  created FIRST: under a claim the fill's hydration ids must match the
 *  producer's (`sc-<fid>-<k>-0` is the `<li>`), so the observer memo takes
 *  the id after it. */
function makeFill(log: { invocations: number; seen: string[]; cleanups: number }) {
  return (p: { text: string }) => {
    log.invocations++;
    const li = <li>{p.text}</li>;
    createMemo(() => log.seen.push(p.text));
    onCleanup(() => log.cleanups++);
    return li;
  };
}
const freshLog = () => ({ invocations: 0, seen: [] as string[], cleanups: 0 });

/** Latch global hydration done the way a completed root pass does (see
 *  c02): the post-done arms need the ledger's held-swap policy in force. */
function completeHydrationPass() {
  const other = document.createElement("div");
  document.body.appendChild(other);
  hydrate(() => null, other)();
  other.remove();
}

/** A stream-face site over `getX()` with the instrumented fill under `item`. */
function mountSite(getX: () => unknown, log: ReturnType<typeof freshLog>) {
  const Site = dynamic(() => getX() as any);
  let div!: HTMLDivElement;
  const applied: string[] = [];
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>fallback</span>}>
        <Site item={makeFill(log)} />
      </Loading>
    </div>;
    document.body.appendChild(div);
    return d;
  });
  div.addEventListener("frame:applied", (e: any) => applied.push(e.detail?.reason ?? "?"));
  return { div, dispose, applied };
}

describe("C14 — disposal leaves nothing", () => {
  // Arm (a): document face, disposed during the record wait. The parser is
  // "still running" (readyState loading); the occurrence's record is
  // DECLARED at its marker (S-record) but its settle has not executed, so
  // the frame waits on it. Dispose before the settle; then the record lands.
  test("(a) dispose during the record wait: the late record never invokes the fill", async () => {
    const fid = freshFid("c14a");
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    page = bootPage(
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    const record = page.declareSlotRecord(fid, "item#0");
    const Comp = (globalThis as any)._$SC.r(fid);
    const log = freshLog();
    const li = page.container.querySelector("li")!;
    const dispose = createRoot(d => {
      <Comp item={makeFill(log)} />;
      return d;
    });
    await microtasks(2);
    expect(log.invocations).toBe(0);
    dispose();
    // The record's settle script the parser was owed, then every beat a
    // re-sync would have used.
    record.settle({ text: "one" });
    await quiesce();
    await quiesce();
    expect(log.invocations).toBe(0);
    expect(page.container.querySelector("li")).toBe(li);
    expect(page.container.textContent).toBe("one");
    expect(page.errors).toEqual([]);
  });

  // Arm (b): stream face, disposed during a `{$ref}` wait. The slot record
  // references data that has not arrived: the host settled the ref into a
  // pending read at the write (frames A4, S-ref) and the fresh mount waits
  // for it to settle; dispose; then the data, a `complete`, and the body's
  // end — the settle re-applies the record to no frame.
  test("(b) dispose during a {$ref} wait: the data's arrival never invokes the fill", async () => {
    const id = freshFid("c14b");
    const { host } = makeHost();
    installServerComponents(host);
    const { held } = stubHeldFetch([id]);
    const getX = createServerReference(id);
    const log = freshLog();
    const site = mountSite(() => getX(), log);
    await pump();
    held[0].send({ type: "start", id, version: 1 });
    held[0].send({ type: "slot", id, version: 1, key: "item#0", args: { text: { $ref: "1" } } });
    held[0].send({
      type: "html",
      id,
      version: 1,
      html: `<ul>${slotRange("item#0")}</ul>`
    });
    await pump();
    const frameEl = site.div.querySelector("solid-frame")!;
    expect(frameEl.querySelector("ul")).not.toBeNull();
    expect(log.invocations).toBe(0);
    const html = frameEl.innerHTML;
    // The dispose tears the boundary's DOM down; the frame element (now
    // detached) is what a stray apply would still write into.
    site.dispose();
    site.applied.length = 0;
    for (const c of createDataSource().chunks(id, 1, { "1": "late" })) held[0].send(c);
    held[0].send({ type: "complete", id, version: 1 });
    held[0].close();
    await pump(3);
    expect(log.invocations).toBe(0);
    expect(frameEl.innerHTML).toBe(html);
    expect(site.applied).toEqual([]);
  });

  // Arm (c): document face, disposed during a late-boundary wait. The
  // boundary element is still inside a pending fragment when the site
  // mounts (the mount waits, showing the fallback); dispose; then the
  // fragment reveals the element and its record lands. The dead mount must
  // not adopt it — and a FRESH mount afterwards must, as if the first never
  // existed.
  test("(c) dispose during a late-boundary wait: the revealed element is adopted by a new mount, not the dead one", async () => {
    const fid = freshFid("c14c");
    const frag = "c14c";
    page = bootPage(placeholderHtml(frag, "<i>loading</i>"));
    page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const dead = freshLog();
    let deadDiv!: HTMLDivElement;
    const disposeDead = createRoot(d => {
      <div ref={deadDiv}>
        <Loading fallback={<span>fallback</span>}>
          <Comp item={makeFill(dead)} />
        </Loading>
      </div>;
      page!.container.appendChild(deadDiv);
      return d;
    });
    await quiesce(1);
    expect(deadDiv.textContent).toBe("fallback");
    disposeDead();
    deadDiv.remove();
    // The fragment delivers the boundary (with its record) after the dispose.
    page.slotRecord(fid, "item#0", { text: "one" });
    page.revealFragment(
      frag,
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    await quiesce();
    await quiesce();
    expect(dead.invocations).toBe(0);
    expect(page.container.querySelector("solid-frame")).not.toBeNull();
    const li = page.container.querySelector("li")!;
    expect(li.textContent).toBe("one");
    // A fresh mount adopts the element the dead one never claimed (a fill's
    // claim runs under the hydrate registry, so this mount hydrates).
    const live = freshLog();
    const disposeLive = hydrate(() => <Comp item={makeFill(live)} />, page.container);
    disposers.push(disposeLive);
    await quiesce();
    expect(live.invocations).toBe(1);
    expect(live.seen).toEqual(["one"]);
    expect(page.container.querySelector("li")).toBe(li);
    expect(dead.invocations).toBe(0);
    expect(page.errors).toEqual([]);
    expect(page.warnings.filter(w => w.includes("Hydration key miss"))).toEqual([]);
  });

  // Arm (d): stream face, disposed mid-stream with a fill mounted. Later
  // chunks — a hole morph, a changed slot record, a root morph — must not
  // touch the DOM, push into the fill, or announce an apply; the fill's own
  // cleanup ran at the dispose.
  test("(d) dispose mid-stream: later chunks never touch the DOM or invoke a fill", async () => {
    const id = freshFid("c14d");
    const { host } = makeHost();
    installServerComponents(host);
    const { held } = stubHeldFetch([id]);
    const getX = createServerReference(id);
    const log = freshLog();
    const site = mountSite(() => getX(), log);
    await pump();
    held[0].send({ type: "start", id, version: 1 });
    held[0].send({ type: "slot", id, version: 1, key: "item#0", args: { text: "one" } });
    held[0].send({
      type: "html",
      id,
      version: 1,
      html: `<p>${holeHtml(0, "h0")}</p><ul>${slotRange("item#0")}</ul>`
    });
    await pump();
    expect(log.invocations).toBe(1);
    expect(log.seen).toEqual(["one"]);
    expect(site.div.querySelector("p")!.textContent).toBe("h0");
    const frameEl = site.div.querySelector("solid-frame")!;
    const html = frameEl.innerHTML;
    site.dispose();
    expect(log.cleanups).toBe(1);
    site.applied.length = 0;
    held[0].send({ type: "hole", id, version: 1, key: "lh:0", html: "h1" });
    held[0].send({ type: "slot", id, version: 1, key: "item#0", args: { text: "late" } });
    held[0].send({
      type: "html",
      id,
      version: 1,
      html: `<p>${holeHtml(0, "h1")}</p><ul>${slotRange("item#0")}</ul><b>more</b>`
    });
    held[0].send({ type: "complete", id, version: 1 });
    held[0].close();
    await pump(3);
    expect(log.invocations).toBe(1);
    expect(log.seen).toEqual(["one"]);
    expect(frameEl.innerHTML).toBe(html);
    expect(site.applied).toEqual([]);
  });

  // Arm (e): document face, adopted, disposed IN PLACE, then a post-done
  // reveal into the dead element. The adopted element is the component's
  // return value, so a root disposed without detaching it leaves the
  // `<solid-frame>` standing in the document with a server `<Loading>`'s
  // placeholder still inside it. By geometry alone that placeholder reads
  // as the frame's content (frames A5′, `_$HY.fa`: inside a `data-fid`
  // element) and the swap would land — server markup nobody drives,
  // visible and inert. The disposal must disown it: `$df` holds (0), the
  // fallback stands, the record never invokes the fill. A region element
  // between the placeholder and the boundary (the nested-region shape) must
  // not hide the disposed boundary from the predicate.
  test("(e) dispose in place, then a post-done reveal into the dead element: held, nothing lands", async () => {
    const fid = freshFid("c14e");
    const frag = "c14e";
    const nested = "c14e-nested";
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${placeholderHtml(frag, "<i>loading</i>")}` +
          `<solid-frame data-fid="${fid}.sub#0.k" style="display:contents">` +
          `${placeholderHtml(nested, "<i>inner</i>")}</solid-frame></ul>`
      )
    );
    completeHydrationPass();
    page.declareFragment(frag);
    page.declareFragment(nested);
    const Comp = (globalThis as any)._$SC.r(fid);
    const log = freshLog();
    const dispose = createRoot(d => {
      <Comp item={makeFill(log)} />;
      return d;
    });
    await quiesce();
    const frameEl = page.container.querySelector("solid-frame")!;
    expect(frameEl).not.toBeNull();
    expect(page.container.textContent).toBe("loadinginner");
    dispose();
    // Disposed, but still in the document — the shape under test.
    expect(frameEl.isConnected).toBe(true);
    expect(page.container.querySelector("solid-frame")).toBe(frameEl);
    const html = frameEl.innerHTML;
    page.slotRecord(fid, "item#0", { text: "one" });
    expect(page.revealFragment(frag, slotRange("item#0", fillHtml(fid, "item#0", "one")))).toBe(0);
    expect(page.revealFragment(nested, "<b>late</b>")).toBe(0);
    await quiesce();
    await quiesce();
    expect(frameEl.innerHTML).toBe(html);
    expect(page.container.textContent).toBe("loadinginner");
    expect(log.invocations).toBe(0);
    expect(page.errors).toEqual([]);
  });

  // Control for (e): the same page NOT disposed — the placeholder inside the
  // live adopted element is the frame's content by rendering, the swap
  // lands (1) and the revealed occurrence mounts.
  test("(e-control) undisposed, the same post-done reveal lands and the fill runs", async () => {
    const fid = freshFid("c14e-control");
    const frag = "c14e-control";
    page = bootPage(frameHtml(fid, `<ul>${placeholderHtml(frag, "<i>loading</i>")}</ul>`));
    completeHydrationPass();
    page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const log = freshLog();
    const dispose = createRoot(d => {
      <Comp item={makeFill(log)} />;
      return d;
    });
    disposers.push(dispose);
    await quiesce();
    expect(page.container.textContent).toBe("loading");
    page.slotRecord(fid, "item#0", { text: "one" });
    expect(page.revealFragment(frag, slotRange("item#0", fillHtml(fid, "item#0", "one")))).toBe(1);
    await quiesce();
    await quiesce();
    expect(page.container.textContent).toBe("one");
    expect(log.invocations).toBe(1);
    expect(log.seen).toEqual(["one"]);
    expect(page.errors).toEqual([]);
  });

  // Control: undisposed, the same late chunks land — the hole morphs, the
  // changed record pushes into the live fill (no re-call), the root morphs.
  test("(control) undisposed, the same late chunks land: the fill runs once and the root morphs", async () => {
    const id = freshFid("c14e");
    const { host } = makeHost();
    installServerComponents(host);
    const { held } = stubHeldFetch([id]);
    const getX = createServerReference(id);
    const log = freshLog();
    const site = mountSite(() => getX(), log);
    disposers.push(site.dispose);
    await pump();
    held[0].send({ type: "start", id, version: 1 });
    held[0].send({ type: "slot", id, version: 1, key: "item#0", args: { text: "one" } });
    held[0].send({
      type: "html",
      id,
      version: 1,
      html: `<p>${holeHtml(0, "h0")}</p><ul>${slotRange("item#0")}</ul>`
    });
    await pump();
    expect(log.invocations).toBe(1);
    held[0].send({ type: "hole", id, version: 1, key: "lh:0", html: "h1" });
    held[0].send({ type: "slot", id, version: 1, key: "item#0", args: { text: "late" } });
    held[0].send({
      type: "html",
      id,
      version: 1,
      html: `<p>${holeHtml(0, "h1")}</p><ul>${slotRange("item#0")}</ul><b>more</b>`
    });
    held[0].send({ type: "complete", id, version: 1 });
    held[0].close();
    await pump(3);
    expect(log.invocations).toBe(1);
    expect(log.cleanups).toBe(0);
    expect(log.seen).toEqual(["one", "late"]);
    expect(site.div.querySelector("p")!.textContent).toBe("h1");
    expect(site.div.querySelector("li")!.textContent).toBe("late");
    expect(site.div.querySelector("b")!.textContent).toBe("more");
    expect(site.applied.length).toBeGreaterThan(0);
  });
});
