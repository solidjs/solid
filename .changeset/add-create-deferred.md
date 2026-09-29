---
"@solidjs/signals": patch
"solid-js": patch
---

Add `createDeferred`: an async memo that may lag the global clock but never leads it. Once it has a committed value, a refetch is served the previous answer instead of suspending — readers keep rendering, the input's write commits immediately, and the landing commits on its own schedule — while `isPending` stays loud (including through sync derivations and derived stores). The first load still suspends to the nearest `<Loading>`; `loadingValue` composes. A flight asked against a write another node holds reveals with that write. `refresh(d)` and `until` wait for the landed truth, including a predicate that reads the node through a derived memo. Errors propagate. On the server it is `createMemo`.
