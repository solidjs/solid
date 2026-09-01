---
"@solidjs/signals": patch
---

Close the structural-audit findings on the patch channel's row/slot machinery: the late-registrant resync sweep is rebuilt on registration-sequence numbers (fixed window at both edges, hold-honoring deferral, O(#late) suffix scan instead of quadratic rescans), drain-resolved structural resyncs read the visible optimistic view instead of committed backing, slot ticks coalesced past a shrink are skipped, and a landing consumption stamps a structural generation so stale transition-held row/slot work can no longer replay over its resync at settle.
