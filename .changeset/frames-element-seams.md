---
"@solidjs/web": patch
---

Adopt the element-based frame seams from `@dom-expressions/runtime`: a server-component boundary is now a client-owned `<dx-frame>` element rather than a branded comment-marker range. `boundaryComponent` uses `createFrameElement` and returns the element (which `insert` places natively in any position, fixing the array/fragment crash class), and `documentBoundary` adopts the SSR'd boundary element via `createFrame(el, { adopt: true })`, located by a single `[data-fid]` attribute query instead of a comment-pair TreeWalk. The occlusion drain, hydration-claim scoping, and stable-component transport policy are unchanged. Requires `@dom-expressions/runtime` with the element seam (`createFrameElement`/`FRAME_ID_ATTR`, `createFrame` adopt option); `createFrameInsertable`/`adoptFrameRange` are gone.
