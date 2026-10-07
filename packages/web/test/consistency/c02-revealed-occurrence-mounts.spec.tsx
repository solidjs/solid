/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C2 — no inert server content.
 *
 * "At quiescence, every occurrence whose marker pair is in a frame's shown
 * content and whose prop the client supplies is mounted — including
 * occurrences a document fragment reveals into an adopted region AFTER
 * adoption — so no server-rendered client content sits in the page without
 * a live fill behind it."
 *
 * Mechanism meant to carry it: frames/src/frame-client.ts
 * `FrameImpl.#syncSlots` (range discovery over the frame's content) driven
 * by frames/src/client.ts `adoptBoundary`'s `fr.subscribe` cascade
 * (`drainRecords` + the reveal-is-an-apply write). A swap into the region
 * needs no claim from the adoption: a placeholder inside a `data-fid`
 * element is the frame's content by rendering (`_$HY.fa`, frames A5′).
 *
 * Liveness is the assertion: a fill is "mounted" when a client signal it
 * reads drives the DOM. Every fill here reads `tick()` in a text hole
 * (`<li>{p.text}{tick()}</li>` ↔ server `fillHtml2(…, "one", "0")`;
 * `<b>{tick()}</b>` ↔ server `<b _hk=…>0</b>`), the test bumps it after
 * quiescence and asserts the DOM followed.
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
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

/** The server render of `p => <li>{p.text}{tick()}</li>` at tick 0. */
const liveFillHtml = (fid: string, occ: string, text: string) => fillHtml2(fid, occ, text, "0");
/** The server render of `<Comp><b>{tick()}</b></Comp>`'s children at tick 0. */
const liveChildrenHtml = (fid: string) => fillHtml(fid, "children", "0", "b");

/**
 * A frame whose root content is a pending server <Loading> (fragment `frag`).
 * One fragment key per test: the ledger's claim state (`_fragments` in
 * solid/src/client/hydration.ts) is module-level and keyed by fragment id,
 * and a red arm's boundary never disposes (the failing assertion throws
 * first), so a shared key would stay claimed into the next test.
 */
const pendingShell = (fid: string, frag: string) =>
  frameHtml(fid, `<ul>${placeholderHtml(frag, "<i>loading</i>")}</ul>`);

/**
 * Latch global hydration done the way a completed root pass does
 * (`_hydrationDone` flips synchronously at the pass's end). Not awaited: the
 * drain's own setTimeout marks `_$HY.done`, and a `hydrate()` after that
 * would render instead of claim — the real page's pass must start first.
 */
function completeHydrationPass() {
  const other = document.createElement("div");
  document.body.appendChild(other);
  hydrate(() => null, other)();
  other.remove();
}

describe("C2 — no inert server content", () => {
  // Arm (c1): reveal BEFORE hydrate on a fresh page. `_hydrationDone` is a
  // module latch set by the first completed hydrate pass, so the pre-done
  // state exists only before any hydrate ran in this worker — this arm MUST
  // be the file's first test, and asserts that precondition (`$df` swapped
  // at once: 1). The fragment (record + swap) lands while the page is
  // unhydrated; adoption then finds the range in its content at t=0.
  test("(c1) reveal-before-hydrate, pre-done swap: the occurrence claims at t=0 and is live", async () => {
    const fid = freshFid("c2c1");
    const frag = "c2c1";
    page = bootPage(pendingShell(fid, frag));
    page.declareFragment(frag);
    page.slotRecord(fid, "item#0", { text: "one" });
    const swapped = page.revealFragment(
      frag,
      slotRange("item#0", liveFillHtml(fid, "item#0", "one"))
    );
    expect(swapped).toBe(1);
    const serverLi = page.container.querySelector("li")!;
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    const invocations: number[] = [];
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
    expect(page.container.textContent).toBe("one0");
    expect(invocations.length).toBe(1);
    expect(page.container.querySelector("li")).toBe(serverLi);
    setTick(1);
    flush();
    expect(page.container.textContent).toBe("one1");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (a1): the producer's order — the fragment chunk carries the
  // occurrence's record (data script) and then the swap. The reveal's drain
  // finds a NEW record, applies it, and the re-sync mounts the range.
  test("(a1) render-prop occurrence revealed after adoption, record before the reveal: mounted and live", async () => {
    const fid = freshFid("c2a1");
    const frag = "c2a1";
    page = bootPage(pendingShell(fid, frag));
    page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    const invocations: number[] = [];
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
    expect(page.container.textContent).toBe("loading");
    expect(invocations.length).toBe(0);

    page.slotRecord(fid, "item#0", { text: "one" });
    page.revealFragment(frag, slotRange("item#0", liveFillHtml(fid, "item#0", "one")));
    await quiesce();
    const li = page.container.querySelector("li")!;
    expect(page.container.textContent).toBe("one0");
    expect(invocations.length).toBe(1);

    setTick(1);
    flush();
    expect(page.container.textContent).toBe("one1");
    expect(page.container.querySelector("li")).toBe(li);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (a2): the record lands AFTER the reveal. Under the declared-record
  // protocol (frames A4, S-record) the producer writes the record at the
  // occurrence's marker as a PENDING value — with the fragment, ahead of
  // its swap — and settles it with the args when they are known; here the
  // settle trails the reveal by two quiescences, with the parser done and
  // no fragment pending (the shape no poll could cover).
  //
  // Was red on `next`: the record was a plain property write to `_$HY.r`
  // observed by nothing — the reveal's drain ran before it, and the
  // `#recordRefresh` poll armed only while `recordsPending()`. Green: the
  // reveal's drain finds the declaration and awaits it (`.then`); the
  // settle is a write the frame sees, re-syncs on, and the deferred mount
  // claims the revealed markup.
  test("(a2) render-prop occurrence revealed after adoption, record settled after the reveal: mounted and live", async () => {
    const fid = freshFid("c2a2");
    const frag = "c2a2";
    page = bootPage(pendingShell(fid, frag));
    page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    const invocations: number[] = [];
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
    expect(invocations.length).toBe(0);

    // The fragment carries the declaration (pending), then the swap.
    const record = page.declareSlotRecord(fid, "item#0");
    page.revealFragment(frag, slotRange("item#0", liveFillHtml(fid, "item#0", "one")));
    await quiesce();
    expect(invocations.length).toBe(0);
    expect(page.container.textContent).toBe("one0");
    record.settle({ text: "one" });
    await quiesce();
    await quiesce();
    expect(page.container.textContent).toBe("one0");
    expect(invocations.length).toBe(1);

    setTick(1);
    flush();
    expect(page.container.textContent).toBe("one1");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (b): a direct-insert occurrence (`children`) is recordless by design.
  // Revealed into the adopted region, it must mount all the same. Was red
  // on `next` (the reveal applied nothing, so no sync ran over the revealed
  // range); green under frames-rulings 2.3 — a reveal is an apply: the
  // document face's reveal cascade syncs the adopting frame.
  test("(b) direct-insert `children` occurrence revealed after adoption: mounted and live", async () => {
    const fid = freshFid("c2b");
    const frag = "c2b";
    page = bootPage(pendingShell(fid, frag));
    page.declareFragment(frag);
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    const dispose = hydrate(
      () => (
        <Comp>
          <b>{tick()}</b>
        </Comp>
      ),
      page.container
    );
    await quiesce();
    expect(page.container.textContent).toBe("loading");

    page.revealFragment(frag, slotRange("children", liveChildrenHtml(fid)));
    await quiesce();
    await quiesce();
    const b = page.container.querySelector("b")!;
    expect(b).not.toBeNull();
    expect(page.container.textContent).toBe("0");

    setTick(1);
    flush();
    // Observed on next: the revealed <b> shows "0" after the bump (the
    // client `children` JSX was never evaluated); no warning, no error.
    // Expected: "1" — the occurrence mounted and its hole is live. Where
    // it goes wrong: client.ts adoptBoundary's `fr.subscribe` callback is
    // the only reaction to a reveal, and it does two things — claim nested
    // `pl-*` placeholders and `drainRecords()`. `drainRecords` applies only
    // NEW `sc:slot:`/`sc:region:` keys; a direct-insert occurrence has no
    // record by design, so nothing reaches `host.apply`, no `#flush` runs,
    // and frame-client.ts `#syncSlots` — the only place a marker pair is
    // discovered and mounted — never walks the revealed content. The
    // reveal itself (`$dfr` → `_$HY.fe`) carries no re-sync.
    expect(page.container.textContent).toBe("1");
    expect(page.container.querySelector("b")).toBe(b);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (c2): reveal BEFORE hydrate, post-done. Global hydration has already
  // completed in this worker (forced here with a throwaway pass, so the arm
  // does not depend on its position in the file). The placeholder sits
  // inside a `data-fid` element, so the pre-hydrate `$df` is the frame's
  // content BY RENDERING (frames A5′, `_$HY.fa`): the ledger swaps it at
  // once (returns 1) with no adoption on record — no hold, no replay — and
  // the adoption that follows finds the markup in place and reads the
  // record synchronously. The final page must equal (c1)'s and (a1)'s.
  test("(c2) reveal-before-hydrate, post-done swap owned by rendering lands before the adoption: same final page", async () => {
    const fid = freshFid("c2c2");
    const frag = "c2c2";
    page = bootPage(pendingShell(fid, frag));
    completeHydrationPass();
    page.declareFragment(frag);
    page.slotRecord(fid, "item#0", { text: "one" });
    const swapped = page.revealFragment(
      frag,
      slotRange("item#0", liveFillHtml(fid, "item#0", "one"))
    );
    expect(swapped).toBe(1);
    expect(page.container.textContent).toBe("one0");
    const serverLi = page.container.querySelector("li")!;
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    const invocations: number[] = [];
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
    expect(page.container.textContent).toBe("one0");
    expect(invocations.length).toBe(1);
    expect(page.container.querySelector("li")).toBe(serverLi);
    setTick(1);
    flush();
    expect(page.container.textContent).toBe("one1");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });
});
