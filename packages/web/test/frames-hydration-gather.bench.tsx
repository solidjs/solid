/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Tier-1 DOM-lane bench. What a document-SSR boundary pays, at its
// adopt-time slot sync, to GATHER the hydration keys its occurrences claim
// by: each adopted occurrence re-enters hydration through the claim window
// (`sharedConfig.hydrateWindow` → the scope's `gather(prefix)`), and the
// gather is what turns the page's `_hk` nodes into registry entries the
// fill's `getNextElement` takes.
//
// The fixture is the HN twins' story page shape (`examples/hackernews`,
// `/stories/30186326`: 1,406 comments, 652 `toggle` occurrences, ~11k
// elements, ~17k comment nodes), flattened to ONE frame with 1,400
// occurrences — the same markup as frames-hydration-walk.bench.ts's cell,
// with the slot RECORDS present (every occurrence mounts at t=0) and a fill
// that claims its two keyed nodes the way a compiled fill does, so one
// iteration is: the page's root `hydrate()` pass, the adoption, 1,400 claim
// windows, 2,800 claims. The gather's share is what moves between the
// per-occurrence root scan (`element.querySelectorAll('[_hk^="…"]')` over
// the hydration root, once per window — 37 ms on the twin page) and the
// per-adoption index (one `[_hk]` scan over the frame element, bucketed by
// occurrence prefix; a window is a map lookup).
//
// `querySelectorAll` calls with a `_hk` selector are counted per iteration
// (`hkScans`, reported once at the end): the per-occurrence form makes one
// per window; the indexed form makes one per adoption.
//
// Under jsdom the DOM is JS, so absolute numbers are not the browser's; the
// shape — how many root scans an adoption makes — is what this bench tracks.
// The twin page's own numbers are in the PR that added this file.
import { afterAll, bench, describe } from "vitest";
import { getNextElement, hydrate } from "@solidjs/web";
import {
  bootPage,
  fillKey,
  frameHtml,
  freshFid,
  quiesce,
  slotRange
} from "./consistency/support.js";

const OCCURRENCES = 1400;

/** The story page's comment list, one frame, `OCCURRENCES` toggles. */
function storyHtml(fid: string) {
  let holes = 0;
  const hole = (text: string) => `<!--lh:${++holes}-->${text}<!--lh:/${holes}-->`;
  let html = `<div class="item-view"><div class="item-view-header"><a href="https://example.com" target="_blank"><h1>Story</h1></a></div><div class="item-view-comments"><ul class="comment-children">`;
  for (let k = 0; k < OCCURRENCES; k++) {
    const occ = `toggle#${k}`;
    html +=
      `<li class="comment">` +
      `<div class="by"><a href="/users/user${k}">${hole(`user${k}`)}</a> <!--$-->${hole("4 years ago")}<!--/--> ago</div>` +
      `<div class="text">${hole(`<p>comment ${k} with some text</p>`)}</div>` +
      `<!--$-->` +
      slotRange(
        occ,
        `<div _hk="${fillKey(fid, occ, 0)}" class="toggle open"><a>[-]</a></div>` +
          `<ul _hk="${fillKey(fid, occ, 1)}" class="comment-children" style="display:block"></ul>`
      ) +
      `<!--/-->` +
      `</li>`;
  }
  return html + `</ul></div></div>`;
}

// The fill: the server rendered `<Toggle>` as two keyed top-level elements
// under the occurrence's producer chain (`sc-<fid>-toggle#k-0`, `-1`); the
// client claims them by key, as a compiled hydratable template's first
// `getNextElement` does for each of its roots.
const toggle = () => [getNextElement(), getNextElement()];

let hkScans = 0;
let hkScanMs = 0;
const countScans = (proto: any) => {
  const original = proto.querySelectorAll;
  proto.querySelectorAll = function (selector: string) {
    if (!selector.includes("_hk")) return original.call(this, selector);
    hkScans++;
    const start = performance.now();
    try {
      return original.call(this, selector);
    } finally {
      hkScanMs += performance.now() - start;
    }
  };
  return () => {
    proto.querySelectorAll = original;
  };
};
const restore = [countScans(Element.prototype), countScans(Document.prototype)];
let iterations = 0;

afterAll(() => {
  for (const r of restore) r();
  const n = Math.max(iterations, 1);
  // eslint-disable-next-line no-console
  console.log(
    `\n[frames-hydration-gather] ${OCCURRENCES} occurrences: ${hkScans / n} "_hk" querySelectorAll call(s) per adoption, ` +
      `${(hkScanMs / n).toFixed(1)} ms in them per iteration (page-level sweep included)`
  );
});

describe("frames adoption gather (HN story shape, 1,400 occurrences)", () => {
  bench(
    "hydrate + adopt + claim every occurrence",
    async () => {
      const fid = freshFid("gather");
      const page = bootPage(frameHtml(fid, storyHtml(fid)));
      for (let k = 0; k < OCCURRENCES; k++) page.slotRecord(fid, `toggle#${k}`, {});
      const Comp = (globalThis as any)._$SC.r(fid);
      iterations++;
      const dispose = hydrate(() => <Comp toggle={toggle} />, page.container);
      await quiesce(1);
      dispose();
      await page.cleanup();
    },
    { iterations: 3, time: 2000 }
  );
});
