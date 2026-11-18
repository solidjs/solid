# Frames hydration walk — the adopt-time slot scan, and a slot index that is not worth its wire (2026-10-08)

Status: steps 1–2 built on `perf/frames-hydration-walk` (this branch, off
`next` @ `8d23a5a13`); step 3 is this note — a design only, no wire change.
Follows the savings pass ([`frames-savings-pass.md`](./frames-savings-pass.md)
§2: the server-announced tier mechanism) and reads its announcement for a
second purpose.

## 1. The finding

A profile of the HN twins' story page (`examples/hackernews`,
`/stories/30186326`: 1,406 comments, 652 `toggle` occurrences, 654 frame
elements, 11,055 elements, 16,897 comment nodes, no `_s:` position,
`sc:tiers = ["regions"]`) put the frame runtime's DOM walk at ≈ 15 ms of
the page's hydration — `collectSlots` and what it called per node
(`slotStartId`'s regex, `hasSlotMarker`, `isTextStart`, `isFrameElement`).
The twins' own profiles pre-dated the tier mechanism; re-baselined on `next`
@ `8d23a5a13` (Chromium, 100 µs sampling, an unminified production build):

| `next` @ `8d23a5a13`, inclusive                 |               ms |
| ----------------------------------------------- | ---------------: |
| `collectSlots`                                  |        **14.23** |
| of which `slotStartId` (regex per node)         |             4.39 |
| `hasSlotMarker` (every element with attributes) |             1.90 |
| `isTextStart` (every node)                      |             1.79 |
| `afterMarker` / `isFrameElement`                |      0.65 / 0.63 |
| `collectRegionElements` (regions tier)          |             0.38 |
| `gatherHydratable` → `querySelectorAll`         | **36.9 of 39.4** |
| non-idle self total                             |            85.18 |

Two things the walk paid for nothing on this page: it tested every element
and every comment for binding-slot markers (`_s:*`, `<!--_s:t=…-->`) so an
un-announced page could detect the bind tier — but the server had already
said, in `sc:tiers`, that it minted none; and it visited every node in JS
(text nodes included) and ran a regex on each to find 652 start markers
among 16,897 comments.

The third row-group is the larger finding and is **out of this pass's
scope**: `gatherHydratable` runs one `element.querySelectorAll('[_hk^="…"]')`
over the hydration root per occurrence, 37 ms on this page — more than
twice the walk. It is the next target.

## 2. What was built (steps 1–2)

1. **The announcement gates the scan, not only the load.** `collectSlots`
   looks for `_s:` markers only when the page may carry them: the bind
   tier's load has started (any announcement — `X-Frame-Tiers`,
   `chunk.tiers`, the install's read of the record — or the walk's own
   detection), or `_$HY.r["sc:tiers"]` names `bind`, or there is no record
   at all (a page that minted no tier, a sync render, an older producer —
   the un-announced fallback keeps detection). Only a page that announced
   OTHER tiers and not `bind` is trusted to carry no position. The record is
   read at each walk, not snapshotted at install: the document face
   re-writes it cumulatively at each mint (`documentNeeds`), so a later data
   script's name is seen by the boundary adopting after it. Regions were
   already content-gated (`needsRegions` per record; the tier's element walk
   runs only inside a resident tier's `resolve`) — nothing to change; pinned.
2. **One TreeWalker pass.** `whatToShow` = comments, plus elements only when
   markers are looked for; a comment's data is tested by prefix
   (`startsWith("slot:")`) before any regex; a range's interior is skipped
   by stepping the walker to its end marker; a nested frame element is
   stepped over whole when elements are shown, and a comments-only walk
   tests a slot start's ancestry instead (once per start, not per node). A
   filter callback was measured and rejected: one JS call per node costs
   more than the walk it saves (11.7 ms against 5.4).

Measured on the same page and build (Chromium, `collectSlots` inclusive):

| variant                                             | min Δ (B) |    brotli (cap 11,130) | `collectSlots` ms |
| --------------------------------------------------- | --------: | ---------------------: | ----------------: |
| `next` @ `8d23a5a13`                                |         0 |                 11,112 |             14.23 |
| gate only (recursive walk unchanged)                |       +94 |       11,126 (−4 room) |              9.92 |
| gate + `startsWith("slot:")` before the regex       |      +123 |       11,134 (+4 over) |              8.08 |
| gate + TreeWalker with a filter callback            |      +241 |      11,227 (+97 over) |             11.72 |
| **gate + TreeWalker by `whatToShow` (this branch)** |  **+333** | **11,264 (+134 over)** |          **5.35** |

jsdom bench (`test/frames-hydration-walk.bench.ts`, 1,400 occurrences, ms
mean, `next` → this branch): announced-no-bind 11.67 → **4.31**;
un-announced 11.57 → **9.38**; bind announced with consumers 17.30 →
**14.94**. (jsdom's TreeWalker is JS, so its gain there is the gate's and
the prefix test's; the browser's is above.)

**The size line.** The frames eager scenario's cap has 18 B brotli of
headroom on `next` and the pass's allowance was 20 B minified. No variant
fits: the gate expression alone (`tierLoads.bind || !(a = _$HY?.r?.["sc:tiers"]) || a.includes("bind")`)
is ≈ 75 B minified. The gate-only variant stays under the brotli cap (the
CI gate passes it) but is 4.7× the allowance; the walker variant on this
branch is over the cap. Measured and reported, per the pass's rule — the
decision is the maintainer's (§4).

## 3. A server-emitted slot index — design, not built

The question: after 1–2, is the walk still a visible fraction, and would a
per-frame index the server emits remove it?

After 1–2 the walk is 5.35 ms of ≈ 72 ms non-idle on the story page (7%):
`nextNode` 1.14 ms over 16,897 comments, `findMarker` 0.51 ms (the sibling
scan to each of 652 end markers), the rest the per-comment prefix test and
the per-slot bookkeeping (`Map.set`, `slotEnd`). What an index could remove
is the per-comment work; what it cannot remove is the need for the start
comment NODE per slot — `found` maps id → node, and the mount anchors on it.

Three shapes:

- **(a) ids only** — `_$HY.r["sc:slots:<fid>"] = ["toggle#0", …]`. Tells the
  client which occurrences exist, not where. Does not replace the walk
  (anchors are still found by walking). Useless alone.
- **(b) child-index paths** — `[[2,1,0,k,5], …]` per slot from the frame
  root. ≈ 13 B per slot JSON → ≈ 8.5 KB raw on this page, ≈ 1.2 KB brotli
  (regular). Client: 652 `childNodes[i]` chains (Chromium caches sequential
  index access; the per-`li` index is sequential). Removes the walk entirely
  (≈ 5 ms → ≈ 0.3 ms est.). Fragile: any node inserted or removed before the
  frame adopts — a deferred fragment's template swapped for its content
  (`$df`), a placeholder reveal, a nested frame's own fills on the stream
  face, an extension — shifts every path after it. The stream face has no
  index (its markup is the client's own morph), so two code paths stay.
- **(c) comment ordinals, delta-coded** — `[12,12,12,…]`: the start marker's
  ordinal among the frame's comment nodes. ≈ 2 KB raw, ≈ 50–100 B brotli
  (one repeated delta). Client: a comments-only `TreeWalker` stepping
  `nextNode()` 16,897 times with no data read except at the 652 landings
  (regex there for the id). Saves the prefix test and the `findMarker`
  scans: ≈ 2–3 ms of the 5.35. Same fragility as (b) at comment granularity
  (a `$df` reveal adds `<!--$-->` pairs), and the server must count every
  comment it writes inside the frame, nested frames included.

Verdict: **not worth its wire or its second code path at this cost.** (c)
buys ≈ 2–3 ms per 1.4k-comment page for a new record, a server-side comment
counter on the render path and an invariant (comment ordinals stable from
emit to adopt) the reveal machinery does not keep today; (b) buys 5 ms for
≈ 1.2 KB brotli per page and the same invariant at node granularity. The
remaining 5 ms are mostly the platform's own `nextNode` and the per-slot
bookkeeping a record cannot remove; the 37 ms in `gatherHydratable` is the
fraction that is visible. Revisit if a page shape appears where comments
outnumber slots by far more than 26:1 — the index's saving scales with the
comments the walk skips, its wire with the slots.

## 4. Open to the maintainer

1. **Which variant, given the size line.** The walker (this branch, +333
   min / +152 br, best time) needs bytes found elsewhere in the frames eager
   bundle — no cap is raised here; the gate-only variant (+94 min / +14 br,
   under the cap, 14.23 → 9.92 ms) passes the CI gate as it stands but not
   the 20 B allowance; or neither. The pins and bench apply to any of them.
2. **Pages that mint no tier write no `sc:tiers` record** and so stay on the
   detection path (jsdom: 9.4 ms against 4.3 for the announced cell). An
   always-written record (`[]` when nothing was minted) would move them to
   the comments-only walk for ≈ 20 B of wire per page — a wire change, not
   made here.
3. **`gatherHydratable`**: the per-occurrence `querySelectorAll` over the
   hydration root (37 ms on this page) — the next pass.
