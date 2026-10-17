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
// ~17k comment nodes, ~8k text nodes. The walk visits comments alone; the
// platform steps over elements and text.
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

const OCCURRENCES = 1400;
const FID = "bench/story";

/** The story page's comment list, one frame, `OCCURRENCES` toggles. */
function storyHtml() {
  let holes = 0;
  const hole = (text: string) => `<!--lh:${++holes}-->${text}<!--lh:/${holes}-->`;
  let html = `<div class="item-view"><div class="item-view-header"><a href="https://example.com" target="_blank"><h1>Story</h1></a></div><div class="item-view-comments"><ul class="comment-children">`;
  for (let k = 0; k < OCCURRENCES; k++) {
    html +=
      `<li class="comment">` +
      `<div class="by"><a href="/users/user${k}">${hole(`user${k}`)}</a> <!--$-->${hole("4 years ago")}<!--/--> ago</div>` +
      `<div class="text">${hole(`<p>comment ${k} with some text</p>`)}</div>` +
      `<!--$--><!--slot:toggle#${k}:start-->` +
      `<div _hk="sc-${FID}-toggle#${k}-0" class="toggle open"><a>[-]</a></div>` +
      `<ul _hk="sc-${FID}-toggle#${k}-1" class="comment-children" style="display:block"></ul>` +
      `<!--slot:toggle#${k}:end--><!--/-->` +
      `</li>`;
  }
  return html + `</ul></div></div>`;
}

/** A boundary element holding the fixture, in the document. */
function boundary() {
  const el = document.createElement("solid-frame");
  el.setAttribute("data-fid", FID);
  el.innerHTML = storyHtml();
  document.body.appendChild(el);
  return el;
}

const fill = () => undefined;
const slots = { toggle: fill };

afterAll(() => {
  document.body.innerHTML = "";
});

describe("frames adoption walk (HN story shape, 1,400 occurrences)", () => {
  const el = boundary();
  bench("adopt", () => {
    const frame = createFrame(el, { id: FID, adopt: true, slots });
    frame.dispose();
  });
});
