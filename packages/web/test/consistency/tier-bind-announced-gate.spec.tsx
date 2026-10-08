/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The announcement as the SCAN's gate, not only the load's (frames savings
 * pass §2; the hydration-walk pass). The adopt-time slot walk used to test
 * every element and every comment of a frame's interior for binding-slot
 * markers (`_s:*`, `<!--_s:t=…-->`) so an un-announced page could detect
 * the bind tier it needs. The server knows at render time whether it
 * minted a binding-slot position and says so in `_$HY.r["sc:tiers"]`, so a
 * page that announced OTHER tiers and not `bind` is trusted: its walk is
 * comments-only (`collectSlots` / `mayBind`, frame-client.ts) and never
 * starts the bind tier's load. The three faces pinned here:
 *
 *  - Announced WITHOUT `bind` (`["regions"]`, the HN story page's record):
 *    a `_s:` interior is not scanned — no load, no hold, hydration-done is
 *    not delayed; the frame's range slots mount as before. (A marker on
 *    such a page is a producer out of step with its own announcement, not
 *    a client-side case: the elements sit inert, as an orphan would.)
 *  - The record is read at EACH walk, not snapshotted at install: a later
 *    data script's cumulative re-write that adds `bind` is seen by the
 *    boundary that adopts after it — detection starts the load and holds,
 *    exactly as tier-bind-hold's un-announced arm.
 *  - The regions tier stays content-gated: a page announcing `bind` only,
 *    whose records name no `{$frame}`, never loads `regions` through
 *    adoption (`needsRegions` is a per-record test; the tier's element
 *    walk runs only inside a resident tier's `resolve`).
 *
 * The un-announced fallback (no record at all → detection) is
 * tier-bind-hold's first test; the announced-with-`bind` face its last.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { untrack } from "solid-js";
import { hydrate } from "@solidjs/web";
import { tierLoads } from "../../frames/src/frame-client.js";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  hydrationInProgress,
  quiesce,
  slotRange,
  type Page
} from "./support.js";

/** A tier's load, gated by the test; `release(module)` lands it. */
function gated(name: string) {
  delete (tierLoads as any)[name];
  let resolve!: (m: any) => void;
  const loader = vi.fn(() => new Promise<any>(r => (resolve = r)));
  return { loader, release: (m: any) => resolve(m) };
}

/** The document face of a data occurrence's consumer (as tier-bind-hold's row). */
const rowHtml =
  `<li class="todo" _s:class="row#1:done=completed">` +
  `<!--_s:t=row#1:title-->a<!--/_s:t-->` +
  `<button _s:on:click="row#1:remove">×</button></li>`;

type Row = { id: string; completed: boolean; title: string };

let page: Page | undefined;
const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  await page?.cleanup();
  page = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as any)._$SC;
  delete (tierLoads as any).bind;
  delete (tierLoads as any).regions;
  document.body.innerHTML = "";
});

/**
 * Boot a frame carrying BOTH a data occurrence's consumer and a range slot,
 * with the given announcement and gated loaders for `bind` and `regions`.
 */
function boot(announce: string[] | undefined) {
  const bind = gated("bind");
  const regions = gated("regions");
  const fid = freshFid("tier-gate");
  page = bootPage(
    frameHtml(fid, `<ul>${rowHtml}${slotRange("item#0", fillHtml(fid, "item#0", "one"))}</ul>`),
    {
      tiers: { bind: bind.loader, regions: regions.loader },
      records: announce ? { "sc:tiers": announce } : undefined
    }
  );
  page.slotRecord(fid, "row#1", { id: "1", completed: false, title: "a" });
  page.slotRecord(fid, "item#0", { text: "one" });
  const li = page.container.querySelector("li.todo")!;
  const button = page.container.querySelector("button")!;
  const mounted: string[] = [];
  const items: string[] = [];
  const clicks: string[] = [];
  const start = () => {
    const Comp = (globalThis as any)._$SC.r(fid);
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            items.push(untrack(() => p.text));
            return <li>{p.text}</li>;
          }}
          row={(p: Row) => {
            mounted.push(untrack(() => p.title));
            return {
              get done() {
                return p.completed;
              },
              get title() {
                return p.title;
              },
              remove: () => clicks.push(p.id)
            };
          }}
        />
      ),
      page!.container
    );
    disposers.push(dispose);
  };
  return { bind, regions, fid, li, button, mounted, items, clicks, start };
}

describe("the bind tier — the announcement gates the scan", () => {
  test('announced without `bind` (`["regions"]`): the walk never looks for `_s:` markers — no bind load, no hold; the range slot mounts and hydration completes', async () => {
    const f = boot(["regions"]);
    // The announcement started ITS tier, and only its tier.
    expect(f.regions.loader).toHaveBeenCalledTimes(1);
    expect(f.bind.loader).not.toHaveBeenCalled();
    f.start();
    await quiesce();
    await quiesce();
    // The range slot is the frame's: found and mounted (claimed in place).
    expect(f.items).toEqual(["one"]);
    expect(page!.container.querySelector("li:not(.todo)")!.textContent).toBe("one");
    // The consumer's markers were never read: no load, no consumer entry,
    // no mount, nodes untouched — and no hold: hydration is done.
    expect(f.bind.loader).not.toHaveBeenCalled();
    expect(f.mounted).toEqual([]);
    expect(f.li.className).toBe("todo");
    expect(f.li.textContent).toBe("a×");
    expect(hydrationInProgress()).toBe(false);
    expect(page!.errors).toEqual([]);
  });

  test("the record is read at the walk: a cumulative re-write that adds `bind` after install is seen by the boundary adopting after it — detection starts the load and holds", async () => {
    const f = boot(["regions"]);
    expect(f.bind.loader).not.toHaveBeenCalled();
    // A later data script re-writes the record with the tier a later
    // boundary needs (frame-sink.ts `documentNeeds`, cumulative).
    page!.hy.r["sc:tiers"] = ["regions", "bind"];
    f.start();
    await quiesce();
    // The walk read the record, scanned, met the markers with the tier
    // absent: the load started (once) and the frame holds.
    expect(f.bind.loader).toHaveBeenCalledTimes(1);
    expect(f.mounted).toEqual([]);
    expect(f.li.className).toBe("todo");
    expect(hydrationInProgress()).toBe(true);
    // The range slot does not wait on the consumer's tier.
    expect(f.items).toEqual(["one"]);
    f.bind.release(await import("../../frames/src/bind-tier.js"));
    await quiesce();
    await quiesce();
    expect(f.mounted).toEqual(["a"]);
    f.button.click();
    expect(f.clicks).toEqual(["1"]);
    expect(hydrationInProgress()).toBe(false);
    expect(page!.errors).toEqual([]);
  });

  test("announced with `bind` only: the regions tier is never loaded through adoption when no record names a `{$frame}` (content-gated, as before)", async () => {
    const f = boot(["bind"]);
    expect(f.bind.loader).toHaveBeenCalledTimes(1);
    expect(f.regions.loader).not.toHaveBeenCalled();
    f.start();
    await quiesce();
    // Held on the announced bind load; the range slot mounted.
    expect(f.items).toEqual(["one"]);
    expect(hydrationInProgress()).toBe(true);
    f.bind.release(await import("../../frames/src/bind-tier.js"));
    await quiesce();
    await quiesce();
    expect(f.mounted).toEqual(["a"]);
    expect(f.regions.loader).not.toHaveBeenCalled();
    expect(hydrationInProgress()).toBe(false);
    expect(page!.errors).toEqual([]);
  });
});
