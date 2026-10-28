---
"@solidjs/signals": patch
---

`latest()`, `isPending()` and plain reads of an uninitialized async memo now throw NotReady (A7) while the memo is re-asked as a verdict lane's work, for example when its compute reads `latest(s)` and `s` changes. Before, they returned `undefined`, and the lane's end committed that `undefined` as the memo's first answer, which tripped the flush loop guard (#4362, #4363). During hydration, a chain of memos over `latest()` adopts the streamed answers again instead of asking `fetch(NaN)` (#4376).
