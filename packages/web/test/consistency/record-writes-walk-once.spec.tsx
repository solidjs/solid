/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * A document's slot records reach the frame one write per occurrence (each
 * declared at its marker, settled by its data script). A write that carries
 * only slot records changes no content, so the frame mounts the occurrences
 * it names from the walk it already has instead of walking the whole frame
 * again: a page of N occurrences walks once, not N times.
 */
import { afterEach, expect, test } from "vitest";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml,
  frameHtml,
  freshFid,
  quiesce,
  slotRange,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

const N = 20;

test("records settling one by one after adoption mount their occurrences without re-walking the frame", async () => {
  const fid = freshFid("walk-once");
  const occurrences = Array.from({ length: N }, (_, i) => `item#${i}`);
  page = bootPage(
    frameHtml(fid, `<ul>${occurrences.map(o => slotRange(o, fillHtml(fid, o, "a"))).join("")}</ul>`)
  );
  const pending = occurrences.map(o => page!.declareSlotRecord(fid, o));
  const Comp = (globalThis as any)._$SC.r(fid);

  // Count the frame's slot walks (a comment walker over the frame element).
  const walker = document.createTreeWalker;
  let walks = 0;
  document.createTreeWalker = function (this: Document, root: Node, show?: number, ...rest: any[]) {
    if (show === 0x80 && (root as Element).hasAttribute?.("data-fid")) walks++;
    return walker.call(this, root, show, ...rest);
  } as typeof walker;
  try {
    let mounted = 0;
    const dispose = hydrate(() => <Comp item={() => (mounted++, (<li>a</li>))} />, page.container);
    await quiesce();
    expect(mounted).toBe(0);
    const before = walks;

    for (const p of pending) {
      p.settle({});
      await quiesce();
    }
    expect(mounted).toBe(N);
    expect(page.container.querySelectorAll("li").length).toBe(N);
    expect(page.warnings.filter(w => w.includes("unclaimed"))).toEqual([]);
    expect(walks - before).toBeLessThanOrEqual(1);
    dispose();
  } finally {
    document.createTreeWalker = walker;
  }
});
