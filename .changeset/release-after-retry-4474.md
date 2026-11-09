---
"@solidjs/signals": patch
---

A memo on the observation lifecycle (unowned, or `lazy: true`) that blocked on an async source is no longer released before the retry its source's landing queued (#4474). The settle walk re-enqueues the blocked reader and, finding it unobserved, released it on the spot: the release pulled the retry back out of the heap, so the memo never computed the landing and woke later with no value — `latest()` of it returned `undefined` beside `isPending() === true`. The release now waits for that pass (`REACTIVE_RELEASE_AFTER`): the retry runs once, as the owned twin's does, and the node is released at the pass's tail if it is still unobserved and settled. #2934's contract is kept (no perpetual recompute — one pass, then the release), #3078's untouched (reads revive; a dormant memo dirtied in the same tick is still reclaimed before the heap). Laziness is never observable (D-22).
