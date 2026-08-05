---
"solid-js": minor
---

Server memos participate in the frame sink's binding ledger (DR-2 case 1, watched slot args). Frame renders install two hooks on the SSR context and the server reactive core now honors them; both are absent outside frame renders, where nothing changes:

- `ctx.commit` — settle sites poke it: a promise memo resolving or rejecting, an iterator memo's first value, mutations those settles made. A server-owned render (noHydrate — the HTML is the data) serializes nothing, so without the hook these settles were invisible to the sink's commit funnel and watched slot args latched at first success.
- `ctx.commitEpoch` — per-epoch memo caching: sync-valued memos (the sync fast path and full memos whose last result was plain) cache within one sweep and recompute when pulled after a later commit, so a watched arg's re-evaluation reads current derivations instead of the first render's cache. Async results are exempt — their values advance through their own settle machinery, and re-running them would mint new promises/iterators.
- Iterator memos get a ledger-gated pump: in a server-owned render nothing consumes the iterator past the first value (there is no serialization tap), so when `ctx.commit` exists the core keeps pulling — each yield advances the memo's value and commits. The pump never holds the response open; completion latches the last yield. The document-SSR tapped path deliberately keeps the first-value lock: markup rendered from V1 must keep reading V1 or a mid-stream boundary retry desyncs the HTML from hydration's replay.
