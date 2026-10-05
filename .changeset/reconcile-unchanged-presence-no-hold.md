---
"@solidjs/signals": patch
---

A store fold's presence notification (`in` subscribers) now diffs the old and new presence of each observed key before writing the node, as the value notification already does (#3743). `setSignal` joins a held node's transaction before its equality gate (A34 (1): a write to a held node is a proposal, the same value or another), so a `reconcile()` outside an action that had deleted an observed key — the incoming snapshot leaving it absent too — made the whole tick the action's: an unrelated `a.value` stayed stale until the action settled. A real presence change still notifies and still proposes on a held node.

The adoption's diff base now materializes a nested prototype-overlay draft (a wide owned record) before it is taken: through the overlay's prototype a key the draft had deleted still read as present, so the presence skip fired on a real deletion and a reconcile restoring the key never re-proposed on the held leaf (it committed the draft's `undefined` beside a backing that had the key).

Two optimistic-store fixes the diff uncovered: a container carrying an arrangement guess is now told of an arrangement change whether or not anything subscribes to the container (for a guessed container the write is the landing that judges the guess — before, only the unconditional presence write reached the lane, so a newer question's rows landing beneath an optimistic push published beside it when the reader subscribed to leaves only); and an older truth re-based under an arrangement guess no longer re-stages a slot whose row the committed backing already shows by key, nor an unchanged `length` (a spurious frame for leaf-only readers).
