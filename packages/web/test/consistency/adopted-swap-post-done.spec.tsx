/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * G4 — a post-done swap into a server component's markup (frames A5′,
 * frames-rulings 3.3, ruled 2026-10-06):
 *
 * "A placeholder inside a server component's element is the frame's content
 * by rendering, not by adoption."
 *
 * The server rendered the `<Loading>` whose fallback the placeholder stands
 * for INSIDE the server component, so no client boundary will ever register
 * as the fragment's claimant (#2978). Under the held-swap policy (#2964) a
 * post-done `$df` with no claimant is held; here the claimant is the
 * geometry: the ledger asks the frames client's ownership predicate
 * (`_$HY.fa`, installed once by `installRevealHook`) whether the `pl-*`
 * template sits inside a `data-fid` element, and an owned swap proceeds —
 * whether the element has been adopted yet or not. No hold, no claim, no
 * replay: an adoption that follows the swap finds the settled markup in
 * place and reads its declared records synchronously (#3844).
 *
 * The negative control pins what did NOT change: a post-done swap for a
 * placeholder OUTSIDE any frame element is held exactly as before.
 */
import { afterEach, describe, expect, test } from "vitest";
import { createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  fillHtml2,
  frameHtml,
  freshFid,
  placeholderHtml,
  quiesce,
  slotRange,
  watchFrames,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

/** Latch global hydration done the way a completed root pass does. */
function completeHydrationPass() {
  const other = document.createElement("div");
  document.body.appendChild(other);
  hydrate(() => null, other)();
  other.remove();
}

const shell = (fid: string, frag: string) =>
  frameHtml(fid, `<ul>${placeholderHtml(frag, "<i>loading</i>")}</ul>`);

describe("G4 — post-done swap into server-component markup is owned by rendering", () => {
  // Arm (a): adopted first (by the page's hydration pass, which completes
  // with the fragment still pending), then the post-done reveal. The
  // adoption put no claim on record (there is nothing to claim); the swap
  // proceeds because the placeholder is inside the frame's element. One
  // visible transition, the revealed occurrence claims the server's `<li>`
  // and is live.
  test("(a) adopted, then a post-done reveal: the swap proceeds and the occurrence mounts live", async () => {
    const fid = freshFid("g4a");
    const frag = "g4a";
    page = bootPage(shell(fid, frag));
    const fr = page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    const invocations: number[] = [];
    const frames = watchFrames(page.container);
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            invocations.push(1);
            return (
              <li>
                {p.text}
                {tick()}
              </li>
            );
          }}
        />
      ),
      page.container
    );
    await quiesce();
    await quiesce();
    expect(page.hy.done).toBe(true);
    expect(frames.frames).toEqual(["loading"]);
    expect(invocations.length).toBe(0);
    expect(page.hy.fr.pending()).toBe(true);

    page.slotRecord(fid, "item#0", { text: "one" });
    const swapped = page.revealFragment(
      frag,
      slotRange("item#0", fillHtml2(fid, "item#0", "one", "0"))
    );
    expect(swapped).toBe(1);
    await quiesce();
    await quiesce();
    frames.sample();
    expect(fr.promise.s).toBe(1);
    expect(frames.frames).toEqual(["loading", "one0"]);
    expect(page.container.querySelector(`template#pl-${frag}`)).toBeNull();
    expect(invocations.length).toBe(1);
    expect(page.hy.fr.pending()).toBe(false);
    setTick(1);
    flush();
    expect(page.container.textContent).toBe("one1");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    frames.stop();
    dispose();
  });

  // Arm (b): the reveal lands BEFORE any mount adopts the element (the
  // #2978 order: the fragment's chunk executes while the client's mount
  // of this boundary is still ahead). Post-done, with no adoption on
  // record, the swap is NOT held — it proceeds at once (1); the ledger
  // reads the fragment delivered, the placeholder is retired. The
  // adoption that follows finds the markup in place: the declared record
  // (`s === 1`) is read synchronously in the adopt-time drain, the fill
  // claims the server's `<li>` by key, and nothing re-renders.
  test("(b) post-done reveal before the mount adopts: no hold, the adoption finds the markup in place and reads the record synchronously", async () => {
    const fid = freshFid("g4b");
    const frag = "g4b";
    page = bootPage(shell(fid, frag));
    completeHydrationPass();
    const fr = page.declareFragment(frag);
    page.slotRecord(fid, "item#0", { text: "one" });
    const swapped = page.revealFragment(frag, slotRange("item#0", fillHtml(fid, "item#0", "one")));
    expect(swapped).toBe(1);
    expect(fr.promise.s).toBe(1);
    // Delivered as far as the ledger is concerned — nothing held, nothing to
    // replay, nothing pending.
    expect(page.hy.fr.pending()).toBe(false);
    expect(page.container.querySelector(`template#pl-${frag}`)).toBeNull();
    expect(page.container.textContent).toBe("one");
    const serverLi = page.container.querySelector("li")!;

    const Comp = (globalThis as any)._$SC.r(fid);
    const invocations: number[] = [];
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            invocations.push(1);
            return <li>{p.text}</li>;
          }}
        />
      ),
      page.container
    );
    // The drain is synchronous for a settled record: the fill has run by the
    // time hydrate() returns, against the server's element.
    expect(invocations.length).toBe(1);
    await quiesce();
    await quiesce();
    expect(invocations.length).toBe(1);
    expect(page.container.querySelector("li")).toBe(serverLi);
    expect(page.container.textContent).toBe("one");
    expect(page.warnings.filter(w => w.includes("Hydration key miss"))).toEqual([]);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (c): the nested shape — the placeholder sits under a REGION element
  // (`data-fid="<fid>.<occurrence>.<key>"`) inside the boundary. Ownership
  // reads the nearest `data-fid` ancestor; a region is as much the frame's
  // rendering as the boundary itself, so the swap proceeds.
  test("(c) a placeholder under a nested region element is owned by rendering too", async () => {
    const fid = freshFid("g4c");
    const frag = "g4c";
    page = bootPage(
      frameHtml(
        fid,
        `<ul><solid-frame data-fid="${fid}.sub#0.k" style="display:contents">` +
          `${placeholderHtml(frag, "<i>loading</i>")}</solid-frame></ul>`
      )
    );
    completeHydrationPass();
    page.declareFragment(frag);
    expect(page.revealFragment(frag, "<b>late</b>")).toBe(1);
    expect(page.container.textContent).toBe("late");
    expect(page.hy.fr.pending()).toBe(false);
    expect(page.errors).toEqual([]);
  });

  // Negative control: the same post-done reveal for a placeholder that is
  // NOT inside any frame element — the shell's own `<Loading>` around a
  // call, say — has no claimant and is HELD (#2964), as before A5′.
  test("(control) a post-done reveal outside any frame element is still held", async () => {
    const frag = "g4-held";
    page = bootPage(`<div>${placeholderHtml(frag, "<i>loading</i>")}</div>`);
    completeHydrationPass();
    const fr = page.declareFragment(frag);
    expect(page.revealFragment(frag, "<b>late</b>")).toBe(0);
    expect(fr.promise.s).toBe(1);
    expect(page.container.textContent).toBe("loading");
    expect(page.container.querySelector(`template#pl-${frag}`)).not.toBeNull();
    // Held is still pending: the document may yet deliver it to a claimant.
    expect(page.hy.fr.pending()).toBe(true);
    expect(page.errors).toEqual([]);
  });
});
