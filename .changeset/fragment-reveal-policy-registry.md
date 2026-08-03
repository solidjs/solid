---
"solid-js": patch
---

Own streamed-fragment reveal policy in the hydration runtime. `enableHydration()` installs `_$HY.f`, and every `$df(id)` the stream emits routes through it: swaps proceed while hydration is in progress or the fragment's boundary is on record as its claimant; unclaimed post-done arrivals are held intact and replayed the moment their boundary registers — before any of its paths read the DOM. This replaces the `markFragmentClaim`/`_$HY.fk`/`_$HY.hq` flag protocol from #2964 with a single owner, and closes a hole in it: a held swap arrives in the same chunk that settles the `<id>_fr` ref, so a boundary rendering later took the settled path (which assumes the swap already ran) and never consulted the hold queue.
