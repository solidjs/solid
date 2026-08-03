---
"@solidjs/web": patch
---

Fix hydrated `clientOnly` desyncing DOM bookkeeping for following siblings. The client half's post-settle swap was armed with `onSettled`, which registers a tracked effect — an id-consuming owner the server half (whose only owner is the fallback mirror memo) never mints. Every sibling created after a hydrated `clientOnly` therefore derived its hydration id one slot past the server's, its template claim missed the registry, and `insert` tracked a never-inserted phantom node: the sibling's first post-hydration re-render reconciled against the phantom and inserted the new content beside the orphaned server node instead of replacing it (first surfaced as duplicated nodes after an HMR hot-swap of a component following a `clientOnly`). The swap is now armed through `sharedConfig.onHydrationEnd` — the ownerless "all hydration complete" channel — so `clientOnly` consumes exactly one child id on both sides.
