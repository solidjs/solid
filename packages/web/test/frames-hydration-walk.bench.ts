/**
 * @vitest-environment jsdom
 */
// Tier-1 DOM-lane bench. The frames client's ADOPTION WALK — what a
// document-SSR boundary pays at its adopt-time slot sync to find every slot
// occurrence in markup already in the page (`FrameImpl` on the adopt path:
// `#syncSlots` → `collectSlots`, then one record lookup per occurrence).
// The fixture is shaped like the HN twins' story page
// (`examples/hackernews`, `/stories/30186326`: 1,406 comments, 652 `toggle`
// occurrences, ~11k elements, ~17k comment nodes — every text hole a
// `<!--$--><!--lh:N-->…<!--lh:/N--><!--/-->` pair) flattened to ONE frame
// with 1,400 occurrences, so one sync walks the whole tree: ~11k elements,
// ~17k comment nodes, ~8k text nodes (the bind cell adds a span and a text
// pair per comment: ~12.6k / ~19.6k / ~9.8k).
//
// Three cells, one fixture shape:
//
//   - `announced, no bind`: the page's `sc:tiers` record names other tiers
//     (the twin page's `["regions"]`) — no `_s:` positions exist, and the
//     walk must not look for them (no element attribute scan, no `_s:t=`
//     test per comment, no bind-tier load).
//   - `un-announced`: no `sc:tiers` record (a page that minted no tier, or
//     an older producer) — the detection path: the walk keeps testing for
//     markers, so a consumer it meets can hold the frame on the tier.
//   - `bind announced, consumers`: `sc:tiers` names `bind`, the tier is
//     resident, and every comment carries a class position and a text
//     position (`_s:class`, `<!--_s:t=…-->`) — the gated path exercised:
//     the walk parses positions into consumer lists in document order.
//
// The frame adopts WITHOUT a host, so no occurrence has a record: every
// called occurrence is found and then waits (the sync's record wait), no
// fill runs and the markup is never touched — one iteration is the walk and
// the per-occurrence bookkeeping, on the same fixture every time (the frame
// is disposed at the end of each iteration; `liveFrames` stays bounded).
// Under jsdom the DOM is JS, so absolute numbers are not the browser's; the
// shape (what the walk touches per node) is what this bench tracks — the
// twin page's own numbers are in the PR that added this file.
import { afterAll, bench, describe } from "vitest";
import { createFrame } from "../frames/src/client.js";
import * as bindTier from "../frames/src/bind-tier.js";
import { tierLoads } from "../frames/src/frame-client.js";

const OCCURRENCES = 1400;
const FID = "bench/story";

/** The story page's comment list, one frame, `OCCURRENCES` toggles. */
function storyHtml(bind: boolean) {
  let holes = 0;
  const hole = (text: string) => `<!--lh:${++holes}-->${text}<!--lh:/${holes}-->`;
  let html = `<div class="item-view"><div class="item-view-header"><a href="https://example.com" target="_blank"><h1>Story</h1></a></div><div class="item-view-comments"><ul class="comment-children">`;
  for (let k = 0; k < OCCURRENCES; k++) {
    html +=
      `<li class="comment"${bind ? ` _s:class="row#${k}:done=collapsed"` : ""}>` +
      `<div class="by"><a href="/users/user${k}">${hole(`user${k}`)}</a> <!--$-->${hole("4 years ago")}<!--/--> ago</div>` +
      `<div class="text">${hole(`<p>comment ${k} with some text</p>`)}</div>` +
      (bind ? `<span class="title"><!--_s:t=row#${k}:title-->t<!--/_s:t--></span>` : "") +
      `<!--$--><!--slot:toggle#${k}:start-->` +
      `<div _hk="sc-${FID}-toggle#${k}-0" class="toggle open"><a>[-]</a></div>` +
      `<ul _hk="sc-${FID}-toggle#${k}-1" class="comment-children" style="display:block"></ul>` +
      `<!--slot:toggle#${k}:end--><!--/-->` +
      `</li>`;
  }
  return html + `</ul></div></div>`;
}

/** A boundary element holding the fixture, in the document. */
function boundary(bind: boolean) {
  const el = document.createElement("solid-frame");
  el.setAttribute("data-fid", FID);
  el.innerHTML = storyHtml(bind);
  document.body.appendChild(el);
  return el;
}

const fill = () => undefined;
const slots = { toggle: fill, row: fill };

// The bind cell runs with the tier resident, as an announced page has it by
// the time its boundaries adopt: the module stamped on its load (the
// runtime's dispatch table; `tierLoads` is the tier specs' seam). The other
// cells run with the tier ABSENT — a started load is itself an
// announcement the walk honours (a stream's `X-Frame-Tiers`), so the state
// is set per cell, in the bench function (vitest runs no per-iteration
// hooks).
const resident = Object.assign(Promise.resolve(), { r: bindTier });

const cells = [
  { name: "announced, no bind", announce: ["regions"], bind: false },
  { name: "un-announced", announce: undefined, bind: false },
  { name: "bind announced, consumers", announce: ["bind"], bind: true }
];

afterAll(() => {
  delete (globalThis as any)._$HY;
  delete (tierLoads as any).bind;
  document.body.innerHTML = "";
});

describe("frames adoption walk (HN story shape, 1,400 occurrences)", () => {
  for (const { name, announce, bind } of cells) {
    const el = boundary(bind);
    const hy = { r: announce ? { "sc:tiers": announce } : {} };
    bench(name, () => {
      (globalThis as any)._$HY = hy;
      if (bind) (tierLoads as any).bind = resident;
      else delete (tierLoads as any).bind;
      const frame = createFrame(el, { id: FID, adopt: true, slots });
      frame.dispose();
    });
  }
});
