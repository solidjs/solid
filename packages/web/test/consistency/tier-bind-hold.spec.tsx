/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The bind tier's timing pin (frames savings pass §1, row "bind"; §3 row
 * C6). The race: a binding-slot consumer (`_s:*` markers, principles
 * §9.2.3) adopted before `@solidjs/web/frames/bind` has loaded. Lost, the
 * positions would never bind — the elements sit inert with no error. The
 * bound: ANNOUNCE + HOLD, and for the delegated-event window, the STAMP.
 *
 *  - Document face, un-announced (the fallback): the adopt-time walk meets
 *    a marker with the tier absent, starts the load and HOLDS the frame —
 *    its server interior on screen, the frame's hold registered under
 *    frames-rulings 3.1 (hydration-done waits). The install's flush binds
 *    every occurrence; a data occurrence mounts with the CURRENT record
 *    (its positions are written whole at the bind — no claim to match the
 *    markup to), so a record that replaced the adopted one during the hold
 *    is the one the fill sees, once.
 *  - Document face, announced: `_$HY.r["sc:tiers"]` names `bind`;
 *    `installServerComponents` starts the import before any boundary
 *    adopts.
 *  - The REPLAY WINDOW (the C6 ruling, option (a)): the 3.1 hold does NOT
 *    keep it open — the bootstrap queues a delegated event only under an
 *    `_hk` element that is not yet completed, and a frame interior has no
 *    keyed elements of its own (server components render under
 *    NoHydration). The server stamps a bare ` _hk` on every element with
 *    an `_s:on:*` position (and only those; web/src/server.ts
 *    `eventSlotStamp`); the tier marks it completed at the bind and drains
 *    the queue. Both arms are pinned below: a click BEFORE `hydrate()` and
 *    a click DURING the hold each replay into the bound handler at the
 *    install. The mutant — the same page without the stamp — loses both,
 *    pinned as the contrast. The two halves ship together: a stamp the
 *    tier did not complete is worse than none — the bootstrap keeps
 *    queueing the element's events and the delegated handler leaves a
 *    queued event to the replay (`dedupEvent`), so even a click AFTER the
 *    bind is lost; the first test's post-bind click pins the client half.
 *  - The dev completion sweep: a stamped consumer is inside a frame
 *    (`gatherHydratable` leaves frame interiors to their fills), so the
 *    page root's sweep never lists it as unclaimed — no orphan `_hk` after
 *    the bind.
 *
 * A tier, once resident, stays so for the worker: each test gates the load
 * itself (`installServerComponents({ tiers })` replaces the built-in loader)
 * and drops it between tests (`tierLoads`, the runtime's test seam).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { untrack } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { hydrate } from "@solidjs/web";
import { tierLoads } from "../../frames/src/frame-client.js";
import { installBootstrapCapture } from "./generic/support.js";
import {
  bootPage,
  frameHtml,
  freshFid,
  hydrationInProgress,
  keyedElements,
  onHydrationEnd,
  quiesce,
  type Page
} from "./support.js";

/** The bind tier's load, gated by the test; `release()` installs the real module. */
function gatedBind() {
  delete (tierLoads as any).bind;
  let resolve!: (m: any) => void;
  const loader = vi.fn(() => new Promise<any>(r => (resolve = r)));
  return {
    tiers: { bind: loader },
    loader,
    release: async () => resolve(await import("../../frames/src/bind-tier.js"))
  };
}
const resident = () => !!(tierLoads as any).bind?.r;

/**
 * The document face of a row whose fill binds a class, a checkbox, a text
 * and two handlers — as web/src/server.ts writes it (the values beside
 * their markers; the stamp on the two event-slot consumers, `stamp` true).
 */
const rowHtml = (stamp: boolean) =>
  `<ul><li class="todo" _s:class="row#1:done=completed">` +
  `<input type="checkbox" _s:checked="row#1:done" _s:on:input="row#1:toggle"${stamp ? " _hk" : ""}>` +
  `<!--_s:t=row#1:title-->a<!--/_s:t-->` +
  `<button _s:on:click="row#1:remove"${stamp ? " _hk" : ""}>×</button></li></ul>`;

type Row = { id: string; completed: boolean; title: string };

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

/** Boot the row page with the tier gated; wire the fill's probes. */
function bootRow(stamp: boolean, options: { announce?: boolean } = {}) {
  const gate = gatedBind();
  const fid = freshFid("tier-bind");
  page = bootPage(frameHtml(fid, rowHtml(stamp)), {
    tiers: gate.tiers,
    records: options.announce ? { "sc:tiers": ["bind"] } : undefined
  });
  disposers.push(installBootstrapCapture(document.documentElement, ["click", "input"]));
  const button = page.container.querySelector("button")!;
  const input = page.container.querySelector("input")!;
  const li = page.container.querySelector("li")!;
  const mounted: string[] = [];
  const clicks: string[] = [];
  const toggles: string[] = [];
  let mountedAtEnd = -1;
  let inProgressAtEnd: boolean | undefined;
  const start = () => {
    const Comp = (globalThis as any)._$SC.r(fid);
    const dispose = hydrate(
      () => (
        <Comp
          row={(p: Row) => {
            // The mount's record, read once (a fill's own reads are
            // getters — the strict-read diagnostic is right about a direct one).
            mounted.push(untrack(() => p.title));
            return {
              get done() {
                return p.completed;
              },
              get title() {
                return p.title;
              },
              toggle: () => toggles.push(p.id),
              remove: () => clicks.push(p.id)
            };
          }}
        />
      ),
      page!.container
    );
    disposers.push(dispose);
    onHydrationEnd(() => {
      mountedAtEnd = mounted.length;
      inProgressAtEnd = hydrationInProgress();
    });
  };
  return {
    gate,
    fid,
    button,
    input,
    li,
    mounted,
    clicks,
    toggles,
    start,
    atEnd: () => ({ mountedAtEnd, inProgressAtEnd })
  };
}

describe("the bind tier — document face", () => {
  test("un-announced: a consumer in the adopted interior before the load holds the frame (interior on screen, hydration waits); the install binds every position, hydration-done follows, no orphan `_hk`", async () => {
    const row = bootRow(true);
    page!.slotRecord(row.fid, "row#1", { id: "1", completed: false, title: "a" });
    // Nothing announced: no load at install.
    expect(row.gate.loader).not.toHaveBeenCalled();
    row.start();
    await quiesce();
    // The walk met the markers with the tier absent: it started the load
    // (once) and HELD — no fill ran, the server's nodes are untouched, and
    // hydration is not done (3.1: the hold is a pending boundary).
    expect(row.gate.loader).toHaveBeenCalledTimes(1);
    expect(resident()).toBe(false);
    expect(row.mounted).toEqual([]);
    expect(page!.container.querySelector("li")).toBe(row.li);
    expect(row.li.className).toBe("todo");
    expect(row.li.textContent).toBe("a×");
    expect(hydrationInProgress()).toBe(true);
    expect(row.atEnd().mountedAtEnd).toBe(-1);
    expect(page!.errors).toEqual([]);

    // The tier lands: its appliers register, one flush per live frame. The
    // occurrence mounts ONCE and its positions are the client's: the
    // handlers dispatch, the class follows the fill.
    await row.gate.release();
    await quiesce();
    await quiesce();
    expect(resident()).toBe(true);
    expect(row.mounted).toEqual(["a"]);
    expect(page!.container.querySelector("li")).toBe(row.li);
    expect(row.li.textContent).toBe("a×");
    row.button.click();
    expect(row.clicks).toEqual(["1"]);
    row.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.toggles).toEqual(["1"]);
    // Hydration-done came after the mount, not before.
    expect(hydrationInProgress()).toBe(false);
    expect(row.atEnd()).toEqual({ mountedAtEnd: 1, inProgressAtEnd: false });
    // The stamp is on screen (both event-slot consumers, nothing else), and
    // the page root's completion sweep listed none of it: frame interiors
    // are the fills' to claim.
    expect(keyedElements(page!.container)).toEqual([row.input, row.button]);
    expect(page!.warnings.filter(w => w.includes("unclaimed"))).toEqual([]);
    expect(page!.warnings).toEqual([]);
    expect(page!.errors).toEqual([]);
  });

  test("replay arm (i): a click queued BEFORE `hydrate()` against a stamped consumer replays into the bound handler at the install", async () => {
    const row = bootRow(true);
    page!.slotRecord(row.fid, "row#1", { id: "1", completed: false, title: "a" });
    // The user clicked while the page was still parsing: the bootstrap
    // queued it at the element's own `_hk` (nothing above it is keyed).
    row.button.click();
    expect(page!.hy.events).toHaveLength(1);
    expect(page!.hy.events[0][0]).toBe(row.button);
    row.start();
    await quiesce();
    // Held; the queue still holds the click (the element is not completed;
    // the hold keeps hydration — and so `_$HY.events` — alive).
    expect(row.mounted).toEqual([]);
    expect(row.clicks).toEqual([]);
    expect(page!.hy.events).toHaveLength(1);
    expect(hydrationInProgress()).toBe(true);
    // The bind: the handler is on the element, the element is completed,
    // the queue drains into it.
    await row.gate.release();
    await quiesce();
    await quiesce();
    expect(row.mounted).toEqual(["a"]);
    expect(row.clicks).toEqual(["1"]);
    expect(sharedConfig.completed == null || sharedConfig.completed.has(row.button)).toBe(true);
    expect(hydrationInProgress()).toBe(false);
    expect(page!.warnings).toEqual([]);
    expect(page!.errors).toEqual([]);
  });

  test("replay arm (ii): a live click DURING the hold is queued and replays at the bind; the stamp on the other consumer queues its own event type too", async () => {
    const row = bootRow(true);
    page!.slotRecord(row.fid, "row#1", { id: "1", completed: false, title: "a" });
    row.start();
    await quiesce();
    expect(row.mounted).toEqual([]);
    expect(hydrationInProgress()).toBe(true);
    // Mid-hold: the interior is on screen and the user acts on it. The
    // bootstrap's capture is still live (hydration is not done), and the
    // elements carry their own keys: queued, in order.
    row.button.click();
    row.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(page!.hy.events.map((e: any) => e[0])).toEqual([row.button, row.input]);
    expect(row.clicks).toEqual([]);
    expect(row.toggles).toEqual([]);
    await row.gate.release();
    await quiesce();
    await quiesce();
    expect(row.mounted).toEqual(["a"]);
    expect(row.clicks).toEqual(["1"]);
    expect(row.toggles).toEqual(["1"]);
    expect(page!.hy.events == null || page!.hy.events.length === 0).toBe(true);
    expect(hydrationInProgress()).toBe(false);
    expect(page!.errors).toEqual([]);
  });

  test("the mutant — no stamp: the same page loses both arms (nothing is queued without an `_hk` to queue under); the bind itself is unaffected", async () => {
    const row = bootRow(false);
    page!.slotRecord(row.fid, "row#1", { id: "1", completed: false, title: "a" });
    row.button.click();
    expect(page!.hy.events).toHaveLength(0);
    row.start();
    await quiesce();
    expect(row.mounted).toEqual([]);
    row.button.click();
    expect(page!.hy.events).toHaveLength(0);
    await row.gate.release();
    await quiesce();
    await quiesce();
    expect(row.mounted).toEqual(["a"]);
    // Both clicks are gone; a click AFTER the bind dispatches.
    expect(row.clicks).toEqual([]);
    row.button.click();
    expect(row.clicks).toEqual(["1"]);
    expect(keyedElements(page!.container)).toEqual([]);
    expect(page!.errors).toEqual([]);
  });

  test("a record that replaced the adopted one during the hold is the one the fill sees: a data occurrence mounts ONCE, with the CURRENT record (its positions are written whole at the bind)", async () => {
    const row = bootRow(true);
    page!.slotRecord(row.fid, "row#1", { id: "1", completed: false, title: "a" });
    row.start();
    await quiesce();
    expect(row.mounted).toEqual([]);
    // A live slot op re-sends the occurrence's record mid-hold.
    page!.live.push({
      type: "slot",
      fid: row.fid,
      key: "row#1",
      args: { id: "1", completed: true, title: "b" }
    });
    await quiesce();
    expect(row.mounted).toEqual([]);
    expect(row.li.className).toBe("todo");
    await row.gate.release();
    await quiesce();
    await quiesce();
    // One mount, with the replacement; the positions show it.
    expect(row.mounted).toEqual(["b"]);
    expect(row.li.className).toBe("todo completed");
    expect(row.input.checked).toBe(true);
    expect(row.li.textContent).toBe("b×");
    expect(hydrationInProgress()).toBe(false);
    expect(page!.errors).toEqual([]);
  });

  test('announced: `_$HY.r["sc:tiers"]` names `bind` — the import starts at install, before any boundary adopts; the held frame binds on the install', async () => {
    const row = bootRow(true, { announce: true });
    // Started at install (the record), ahead of the adopt-time walk.
    expect(row.gate.loader).toHaveBeenCalledTimes(1);
    expect(resident()).toBe(false);
    page!.slotRecord(row.fid, "row#1", { id: "1", completed: false, title: "a" });
    row.start();
    await quiesce();
    // Held on the load the announcement started; asked no second time.
    expect(row.mounted).toEqual([]);
    expect(row.gate.loader).toHaveBeenCalledTimes(1);
    expect(hydrationInProgress()).toBe(true);
    await row.gate.release();
    await quiesce();
    await quiesce();
    expect(row.mounted).toEqual(["a"]);
    row.button.click();
    expect(row.clicks).toEqual(["1"]);
    expect(hydrationInProgress()).toBe(false);
    expect(page!.warnings).toEqual([]);
    expect(page!.errors).toEqual([]);
  });
});
