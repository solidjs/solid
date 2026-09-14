---
"@solidjs/signals": patch
---

Conditional memos across a held branch change stay coherent with their inputs (#3408, #3410).

- A tracked computation served a live transaction's staged value now enters that transaction, so its result is held with it (#3408). A memo whose branch flipped mainline and started reading a held signal previously published the staged value beside the signal's committed one (`Panel: 1` next to `Count: 0`). The read entry is the twin of the existing write-side (`setSignal`) and stamped-recompute entries.
- A memo's dependencies are the committed frame's until the frame is replaced (#3410): a pass that stages its value leaves the previous pass's dependency tail linked, and the commit trims it. A write to a dependency the committed value still derives from reaches the memo and joins its hold — as an unconditional read would — instead of revealing the write beside a stale committed derivation (`Count: 1` next to `Selected: 0` while `Fixed: false`).
