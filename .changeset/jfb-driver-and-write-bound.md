---
"@solidjs/signals": minor
"@solidjs/web": patch
---

JFB validation pass: the list driver's identity matching unwraps store
proxies on both sides (draft-authored permutations stored proxies verbatim
and rebuilt every surviving row — caught by the keyed-reorder identity
gate), and setter notification is bounded to WRITTEN keys (`t.wk`) instead
of scanning every subscribed node per write — an id-keyed selection store
with thousands of per-row subscribers pays two node visits per select
instead of a full scan (select_lots 47x → 2x of octane). The bound falls
back to the full scan where it cannot hold: array length writes (implicit
index deletes; index writes record `length` alongside), records with
accessors, and class instances (prototype getters derive from arbitrary
fields).
