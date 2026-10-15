/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * G9 — one deferred answer for "the page may still deliver this boundary"
 * (frames A5′): `documentBoundary` pends on `awaitBoundary(id)`, the same
 * promise the intercept hands a CALL for a boundary that is still arriving.
 * The reveal hook settles it when the element lands (adopt) or when the
 * page has no reveal left to deliver it (mount fresh / go to the wire).
 *
 * The exhaustion arm runs the PRODUCER'S order through the shipped `$df`
 * (`revealFragment`: swap script, `_$HY.fe`, then the `_fr` settle in the
 * same batch) and so pins the ledger reading the revealing fragment as
 * delivered from its swap (`_$HY.v`) rather than from a stamp that has not
 * executed yet — the latent bug under which a page's LAST reveal never
 * read as exhaustion and a waiter released on exhaustion waited forever.
 */
import { afterEach, describe, expect, test } from "vitest";
import { createRoot, Loading } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  placeholderHtml,
  quiesce,
  slotRange,
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

const frameSelector = (fid: string) => `solid-frame[data-fid="${fid}"]`;

/** A placeholder mount of `fid` under a client `<Loading>` (non-hydrating). */
function mountPlaceholder(container: Element, fid: string, log: { invocations: number }) {
  const Comp = (globalThis as any)._$SC.r(fid);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>
      <Loading fallback={<span>fallback</span>}>
        <Comp
          item={(p: { text: string }) => {
            log.invocations++;
            return <li>{p.text}</li>;
          }}
        />
      </Loading>
    </div>;
    container.appendChild(div);
    return d;
  });
  return { div, dispose };
}

describe("G9 — a document boundary pends on the page's one arrival answer", () => {
  // Arm (a): streaming (hydration not done), a non-hydrating render mounts
  // the placeholder before its element has parsed. The mount pends on the
  // arrival (fallback shown, nothing fetched — `bootPage`'s fetch throws);
  // the reveal that carries the element answers it, and the mount adopts
  // THAT element.
  test("(a) mounted before the element parses: pends, then adopts the revealed element", async () => {
    const fid = freshFid("g9a");
    const frag = "g9a";
    page = bootPage(placeholderHtml(frag, "<i>loading</i>"));
    page.declareFragment(frag);
    const log = { invocations: 0 };
    const { div, dispose } = mountPlaceholder(page.container, fid, log);
    await quiesce();
    expect(div.textContent).toBe("fallback");
    expect(page.container.querySelectorAll(frameSelector(fid)).length).toBe(0);

    page.slotRecord(fid, "item#0", { text: "one" });
    page.revealFragment(
      frag,
      frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
    );
    await quiesce();
    await quiesce();
    const frames = page.container.querySelectorAll(frameSelector(fid));
    expect(frames.length).toBe(1);
    expect(frames[0].textContent).toBe("one");
    expect(log.invocations).toBe(1);
    // The adopted element IS the component's return value: a non-hydrating
    // mount inserts it at its own position (out of the fallback).
    expect(div.contains(frames[0])).toBe(true);
    expect(div.textContent).toBe("one");
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (c): two mounts of the same boundary both waiting share the one
  // answer. At the arrival the first to resume adopts the element; the
  // other finds the id claimed and mounts fresh (an element is adopted
  // once). One adopted frame, one fresh — never two adoptions, never an
  // orphaned element.
  test("(c) two mounts waiting on one id: one adopts at the arrival, the other mounts fresh", async () => {
    const fid = freshFid("g9c");
    const frag = "g9c";
    page = bootPage(placeholderHtml(frag, "<i>loading</i>"));
    page.declareFragment(frag);
    const log1 = { invocations: 0 };
    const log2 = { invocations: 0 };
    const m1 = mountPlaceholder(page.container, fid, log1);
    const m2 = mountPlaceholder(page.container, fid, log2);
    await quiesce();
    expect(m1.div.textContent).toBe("fallback");
    expect(m2.div.textContent).toBe("fallback");

    page.slotRecord(fid, "item#0", { text: "one" });
    expect(
      page.revealFragment(
        frag,
        frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
      )
    ).toBe(1);
    await quiesce();
    await quiesce();
    const frames = page.container.querySelectorAll(frameSelector(fid));
    expect(frames.length).toBe(2);
    const adopted = [...frames].filter(f => f.textContent === "one");
    expect(adopted.length).toBe(1);
    expect(log1.invocations + log2.invocations).toBe(1);
    expect(page.errors).toEqual([]);
    m1.dispose();
    m2.dispose();
  });

  // Arm (d): disposed during the wait, the shared answer resumes nothing
  // for the dead mount (C14 (c) pins the fresh-mount half).
  test("(d) disposed during the wait: the arrival resumes nothing", async () => {
    const fid = freshFid("g9d");
    const frag = "g9d";
    page = bootPage(placeholderHtml(frag, "<i>loading</i>"));
    page.declareFragment(frag);
    const log = { invocations: 0 };
    const { div, dispose } = mountPlaceholder(page.container, fid, log);
    await quiesce();
    expect(div.textContent).toBe("fallback");
    dispose();
    div.remove();
    page.slotRecord(fid, "item#0", { text: "one" });
    expect(
      page.revealFragment(
        frag,
        frameHtml(fid, `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`)
      )
    ).toBe(1);
    await quiesce();
    await quiesce();
    expect(log.invocations).toBe(0);
    expect(page.container.querySelectorAll(frameSelector(fid)).length).toBe(1);
    expect(page.container.querySelector(frameSelector(fid))!.textContent).toBe("one");
    expect(page.errors).toEqual([]);
  });

  // Arm (b): exhaustion, in the real order, post-done. LAST in the file:
  // `_hydrationDone` is a module latch the throwaway pass below sets for
  // the rest of this worker, and the arms above need the pre-done policy
  // (a top-level placeholder's swap proceeds only while hydration is in
  // progress or a claimant is on record). Boundary A is
  // adopted and live, with a server `<Loading>`'s placeholder inside it —
  // the page's last outstanding fragment. A placeholder mount of X waits
  // (the page may still deliver: that fragment is pending). The fragment
  // reveals UNRELATED content (owned by rendering, so the post-done swap
  // proceeds); the hook runs with the `_fr` stamp still ahead, must read
  // the page as exhausted, and releases X to mount fresh — a client-owned
  // frame rather than a fallback frozen forever.
  test("(b) the page's last reveal, unrelated to the waiter: read as exhaustion before the _fr stamp, the waiter mounts fresh", async () => {
    const fidA = freshFid("g9b-a");
    const fidX = freshFid("g9b-x");
    const frag = "g9b";
    page = bootPage(frameHtml(fidA, `<ul>${placeholderHtml(frag, "<i>loading</i>")}</ul>`));
    completeHydrationPass();
    await quiesce();
    expect(page.hy.done).toBe(true);
    page.declareFragment(frag);
    const CompA = (globalThis as any)._$SC.r(fidA);
    const disposeA = createRoot(d => {
      <CompA item={(p: { text: string }) => <li>{p.text}</li>} />;
      return d;
    });
    await quiesce();

    const log = { invocations: 0 };
    const { div, dispose } = mountPlaceholder(page.container, fidX, log);
    await quiesce();
    expect(div.textContent).toBe("fallback");
    expect(page.container.querySelectorAll(frameSelector(fidX)).length).toBe(0);

    // The producer's order, through the shipped runtime: `$df` (swap, `_$HY.v`,
    // `_$HY.fe`) and only then the `_fr` settle.
    const swapped = page.revealFragment(frag, "<b>late</b>");
    expect(swapped).toBe(1);
    await quiesce();
    await quiesce();
    // Released: a client-owned frame for X, ready to take a call's stream.
    expect(page.container.querySelectorAll(frameSelector(fidX)).length).toBe(1);
    expect(div.textContent).not.toBe("fallback");
    expect(page.container.querySelector(frameSelector(fidA))!.textContent).toBe("late");
    expect(log.invocations).toBe(0);
    expect(page.hy.fr.pending()).toBe(false);
    expect(page.errors).toEqual([]);
    dispose();
    disposeA();
  });
});
