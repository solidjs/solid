/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * The adopted boundary's claim index (frames/src/client.ts `claimScope`):
 * an adoption gathers the hydration keys under its element ONCE, bucketed
 * by occurrence prefix, and every occurrence's claim window
 * (`claimRender` → `sharedConfig.hydrateWindow` → the scope's `gather`)
 * looks its range up — instead of selecting `[_hk^="<prefix>"]` over the
 * whole hydration root once per occurrence (37 ms on the HN story page's
 * 652 toggles, more than the rest of its hydration).
 *
 * Pinned here, by counting `querySelectorAll` calls whose selector names
 * `_hk` (the root's sweep, the index's pass, and — on the old path — one
 * per window) and by node identity:
 *
 *   (a) the number of `_hk` scans an adoption makes does not grow with the
 *       number of occurrences, and every fill claims its server node;
 *   (b) a fragment revealed into the element AFTER hydration-done (the
 *       registry already cleared — corollary 4) refreshes the index for the
 *       revealed parent only: one more scan, on a node inside the frame,
 *       never the root; the revealed occurrence claims the revealed node;
 *   (c) a node the index holds that has since left the document is never
 *       handed to the registry — the node that replaced it under the same
 *       key is (the rule that keeps a server `<Loading>`'s removed fallback,
 *       keyed under the same id as its content, from shadowing the content
 *       at the content's claim).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { sharedConfig } from "solid-js/internal";
import {
  bootPage,
  fillHtml,
  fillHtml2,
  frameHtml,
  freshFid,
  hydrationInProgress,
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

/** Every `querySelectorAll` whose selector names `_hk`, with its receiver. */
function watchKeyScans() {
  const scans: { root: Node; selector: string }[] = [];
  const wrap = (proto: { querySelectorAll(selector: string): NodeList }) => {
    const original = proto.querySelectorAll;
    return vi.spyOn(proto, "querySelectorAll").mockImplementation(function (
      this: Node,
      selector: string
    ) {
      if (selector.includes("_hk")) scans.push({ root: this, selector });
      return original.call(this, selector);
    });
  };
  const spies = [wrap(Element.prototype), wrap(Document.prototype)];
  return {
    scans,
    /** Scans since the last `take()`. */
    take() {
      return scans.splice(0, scans.length);
    },
    stop() {
      for (const s of spies) s.mockRestore();
    }
  };
}

const items = (fid: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    slotRange(`item#${i}`, fillHtml(fid, `item#${i}`, `t${i}`))
  ).join("");

describe("adopted boundary claim index — one gather per adoption, not per occurrence", () => {
  test("(a) the number of _hk scans does not grow with the number of occurrences; every fill claims its node", async () => {
    const scansFor = async (n: number) => {
      const fid = freshFid("cix");
      page = bootPage(frameHtml(fid, `<ul>${items(fid, n)}</ul>`));
      for (let i = 0; i < n; i++) page.slotRecord(fid, `item#${i}`, { text: `t${i}` });
      const Comp = (globalThis as any)._$SC.r(fid);
      const before = [...page.container.querySelectorAll("li")];
      const frameEl = page.container.querySelector("solid-frame")!;
      const watch = watchKeyScans();
      const dispose = hydrate(
        () => <Comp item={(p: { text: string }) => <li>{p.text}</li>} />,
        page.container
      );
      await quiesce();
      const scans = watch.take();
      watch.stop();
      const after = [...page.container.querySelectorAll("li")];
      expect(after.length).toBe(n);
      for (let i = 0; i < n; i++) expect(after[i]).toBe(before[i]);
      expect(page.warnings).toEqual([]);
      expect(page.errors).toEqual([]);
      dispose();
      await page.cleanup();
      page = undefined;
      return { scans, frameEl };
    };
    const one = await scansFor(1);
    const six = await scansFor(6);
    // The root's own sweep (`*[_hk]` over the hydration root) and the
    // adoption's one pass over its element — whatever the occurrence count.
    // On the per-occurrence path this is 1 + n (2 vs 7).
    expect(six.scans.length).toBe(one.scans.length);
    expect(six.scans.length).toBe(2);
    expect(six.scans.filter(s => s.root === six.frameEl).length).toBe(1);
  });

  test("(b) a reveal after hydration-done refreshes the index for the revealed parent, and the revealed occurrence claims its node", async () => {
    const fid = freshFid("cib");
    const frag = "cib";
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", fillHtml(fid, "item#0", "one"))}<li class="pending">${placeholderHtml(frag, "<i>loading</i>")}</li></ul>`
      )
    );
    page.declareFragment(frag);
    page.slotRecord(fid, "item#0", { text: "one" });
    const Comp = (globalThis as any)._$SC.r(fid);
    const frameEl = page.container.querySelector("solid-frame")!;
    const pending = page.container.querySelector("li.pending")!;
    let invocations = 0;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            invocations++;
            return <li>{p.text}</li>;
          }}
        />
      ),
      page.container
    );
    await quiesce();
    expect(invocations).toBe(1);
    // Corollary 4: the server's inner loading state registers nothing, so
    // hydration-done precedes the reveal — and the drain's setTimeout has
    // cleared the root's registry by now. What the late window claims from
    // is the adoption's index, refreshed with what the reveal lands.
    expect(hydrationInProgress()).toBe(false);
    expect(sharedConfig.registry!.size).toBe(0);

    const watch = watchKeyScans();
    page.slotRecord(fid, "item#1", { text: "two" });
    page.revealFragment(frag, slotRange("item#1", fillHtml(fid, "item#1", "two")));
    const revealed = page.container.querySelector("li.pending > li")!;
    expect(revealed.textContent).toBe("two");
    await quiesce();
    const scans = watch.take();
    watch.stop();
    expect(invocations).toBe(2);
    // Claimed in place: the fill's <li> IS the revealed server node.
    expect(page.container.querySelector("li.pending > li")).toBe(revealed);
    expect(page.container.textContent).toBe("onetwo");
    // One scan for the refresh, on the parent the swap announced — inside
    // the frame, never the hydration root.
    expect(scans.length).toBe(1);
    expect(scans[0].root).toBe(pending);
    expect(frameEl.contains(scans[0].root)).toBe(true);
    expect(scans[0].root).not.toBe(page.container);
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  test("(c) a node that left the document is never gathered; its replacement under the same key is", async () => {
    const fid = freshFid("cic");
    const frag = "cic";
    // The occurrence's range and the pending placeholder share one parent —
    // as a server <Loading>'s fallback and the content that replaces it do.
    page = bootPage(
      frameHtml(
        fid,
        `<ul><li class="cell">${slotRange("item#0", fillHtml2(fid, "item#0", "stale", "0", "b"))}${placeholderHtml(frag, "<i>loading</i>")}</li></ul>`
      )
    );
    page.declareFragment(frag);
    // item#0's record is DECLARED but not settled: the occurrence is held
    // (its window has not opened), its node is in the index.
    const record = page.declareSlotRecord(fid, "item#0");
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    let invocations = 0;
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            invocations++;
            return (
              <b>
                {p.text}
                {tick()}
              </b>
            );
          }}
        />
      ),
      page.container
    );
    await quiesce();
    expect(invocations).toBe(0);
    // The indexed node leaves the document and a node carrying the SAME key
    // takes its place — what the swap does to a fallback keyed under the
    // content's id (same owner id on both sides, by design). The reveal
    // under that parent re-indexes it: the index now holds both nodes under
    // one key, the detached one first.
    const stale = page.container.querySelector("b")!;
    const fresh = stale.cloneNode(true) as HTMLElement;
    (fresh.childNodes[1] as Text).data = "fresh";
    stale.replaceWith(fresh);
    page.revealFragment(frag, "<i>revealed</i>");
    await quiesce();
    expect(page.container.textContent).toBe("fresh0revealed");
    // The held occurrence mounts: its window must claim the node that is in
    // the document, not the one the index met first. Liveness tells them
    // apart: a claim of the detached node leaves this one standing but
    // inert (the mismatch keeps the server node, binds nothing to it).
    record.settle({ text: "fresh" });
    await quiesce();
    await quiesce();
    expect(invocations).toBe(1);
    expect(page.container.querySelector("b")).toBe(fresh);
    expect(stale.isConnected).toBe(false);
    setTick(1);
    flush();
    expect(fresh.textContent).toBe("fresh1");
    expect(page.container.textContent).toBe("fresh1revealed");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });
});
