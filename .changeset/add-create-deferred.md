---
"@solidjs/signals": patch
"solid-js": patch
---

Add `createDeferred`: an async memo that may lag the global clock but never leads it. Once it has a committed value, a refetch is served the previous answer instead of suspending — readers keep rendering, the input's write commits immediately, and the landing commits on its own schedule — while `isPending` stays loud (including through sync derivations and derived stores). The first load still suspends to the nearest `<Loading>`; `loadingValue` composes. A flight asked against a write another node holds reveals with that write (never ahead of it), and one asked by an action's write is the action's. `refresh(d)` and `until` wait for the landed truth, including a predicate that reads the node through a derived memo or a derived store. Errors propagate. On the server it is `createMemo`; on the client it hydrates like one.

Built on the hold model (L2): the clamp is the commit-#0 loading window re-opened per pass, the verdict is an `affects()` mark whose scope is the flight, and "never leads" is the seam's own hold decision over the flush's pending nodes. Core carries two optional hooks (`GlobalQueue._deferredLanded`, `_slotDerive`; the seam sweep rides `affects()`'s release hook), a staged-value gate on `commitPendingNode`'s window close, and `REACTIVE_REASK` kept readable through a pass. The only behaviour change reachable without calling `createDeferred`: a loading-window node committed with nothing staged keeps its window open (before, the commit sweep closed it unconditionally).
