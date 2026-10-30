---
"@solidjs/signals": patch
---

`latest()`, `isPending()` and plain reads of an uninitialized async memo now throw NotReady (A7) while the memo is re-asked as a verdict lane's work, for example when its compute reads `latest(s)` and `s` changes. Before, they returned `undefined`, and the lane's end committed that `undefined` as the memo's first answer, which tripped the flush loop guard (#4362, #4363). During hydration, a chain of memos over `latest()` adopts the streamed answers again instead of asking `fetch(NaN)` (#4376).

A memo that reads `latest()` and throws over the committed value of an async input it was served while that input was in flight now re-derives when the input lands, so an `<Errored>` it tripped recovers (D-39). Before, the error stuck until some other input changed.
