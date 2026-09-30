---
"@solidjs/signals": patch
---

Two optimistic-list holes that halted the scheduler under a keyed `mapArray` / `<For keyed={r => r.id}>` (optimistic-list-mutation-matrix findings F5 and F3).

F5 — a derived optimistic store (`createOptimisticStore(() => data())`) whose truth lands with a different length than the optimistic frame (a server-assigned row beside the one the action added, a rejected add, another row in a deleted slot). The landing supersedes the store's `length` and presence overrides (#3331): tracked reads already served the staged truth through `serve`, but the untracked store paths — the `length` view, the `has` trap, `ownKeys` / descriptors, `snapshot()` / `deep()` — still composed the override. `mapArray` reads the list tracked and then untracked inside its owner, so its item snapshot came up short or holey and the next pass handed the key function `undefined`. Every untracked channel now takes the same reader-aware selection as `get` (`readerOverride`: a superseded override answers as `serve` does — the staged truth to a deriving pass, the override to a lane pass or a context-free read, A18). Regressed in #3370 (shipped in rc.9).

F3 — a second tentative draft opened while a prior draft's overrides are live (two pending actions, or two setter calls in one action). The `length` draft arm re-composed the prior draft's overrides onto the draft's already-seeded backing, so after `splice(from, 1)` the length read one too long and the second splice left a hole; it now gates on `draftSeesOverrides` like every other draft channel.
