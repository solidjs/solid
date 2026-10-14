---
"solid-js": patch
"@solidjs/web": patch
---

Frames A5′ — a deferred fragment's placeholder inside a server component's element is the frame's content by rendering, not by adoption (frames-rulings 3.3, ruled 2026-10-06).

**`solid-js`:** the document fragment ledger's `fragmentPolicy` lets a post-done swap proceed when the fragment is owned — its `pl-*` template is in the document and the integration's ownership predicate `_$HY.fa(placeholder)` says so — beside the existing claimant case; no hold, no replay for owned fragments. `_$HY.fr.claim` / `_$HY.fr.release` are removed from the published ledger (`_$HY.fr` is `{ pending, subscribe }`); `_$HY.fa(placeholder): boolean` is the new integration hook. `fragmentPending` now reads a revealed fragment from its swap record (`_$HY.v`) before its `_fr` stamp: the producer emits the swap script and then the `_fr` settle in the same batch, so a `_$HY.fr.pending()` read inside the reveal notification saw the revealing fragment as still pending — a page's last reveal never read as exhaustion and a waiter released on exhaustion waited forever.

**`@solidjs/web` (frames client):** installs `_$HY.fa` once (`pl.closest("[data-fid]")`, minus elements of a boundary disposed in place — C14); deletes `claimRegionFragments`, the per-adoption claim set, the cascade's claim half and the release loop (the dev-only rejection report over the region's `pl-*` templates stays, 0 prod bytes); `documentBoundary` pends on the intercept's one arrival answer (`awaitBoundary`) and `boundaryWaiters` is deleted (G9). A post-done swap into server-component markup no client has adopted yet now lands at once; the adoption that follows finds it in place and reads its declared records synchronously.
