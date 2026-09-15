---
"@solidjs/signals": patch
---

`latest()` of an uninitialized async source now throws `NotReadyError` in every scope. Unowned callers (event handlers, imperative code) used to receive `undefined` — a value the accessor's type excludes — because the uninitialized case shared the pending-shadow fallback's condition in `latestRead`. `isPending()` is unchanged: an unowned probe still answers `false` (A16), which `boolean` admits. Spec: A7 amended, A16 wording corrected (the boundary is ownership, not tracking), A17 authoritative-reader carve-out ruled, A32 added (children-forbidden readers see the frame).
