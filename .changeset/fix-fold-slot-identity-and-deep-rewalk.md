---
"@solidjs/signals": patch
---

rc.6 P1 store sweep — three fold-machinery gaps reported by @brenelz, all predating the #3271 fix:

- **#3282** — an array move (`reverse`/`unshift`/`splice`) plus an edit of a moved row corrupted sibling rows: the row target's parent-key is stamped at wrap time and never followed the move, so the fold's parent-slot re-point wrote the edited row's clone over whichever sibling now occupied the old index (`[1,2]` became `[1,1]`). Fold-time slot writes (privatization stitch, drainFolds path-copy, and the eager-fold twin) now resolve the slot by raw identity when the stamped key is stale — arrays only, fold-time only, no read-path cost.
- **#3283** — `deep()` silently unsubscribed from every untouched child after a parent-field edit: the walk bypasses the proxy traps, and a bare `Reflect.ownKeys` on a plain-object overlay pending backing (own keys = this batch's writes) hid inherited committed keys from the mid-flush re-walk, dropping those records from the effect's refreshed dependency set. The walk now merges committed keys minus deletes, mirroring the ownKeys trap's #3044 overlay merge.
- **#3284** — in derived stores, a descendant write disconnected ancestor observers and broke proxy identity: `privatizeCommitted` registered its clone only in the global lookup, but family targets resolve children through `fam.map`, so the next parent read wrapped a fresh target and orphaned the original's nodes. The clone now registers in the target's own map.
