---
"@solidjs/signals": patch
---

Five hold-consistency fixes (#3456, #3458, #3460, #3463, #3469)

- #3456: a pass that re-parks on a new pending source set retires the sources it stopped carrying from its dependents, so a conditional whose async branch was cancelled no longer stays pending forever on a flight it has no path to.
- #3458: a stale render reader that is a flight's first observer registers the flight with the transaction it reveals a reader of (INV-3, via the reader's queue chain), so the transaction waits for it instead of revealing its other inputs beside the reader's pre-flight value.
- #3460: lanes mirror transitions from the outside — a render effect off a held lane (mounted mid-hold, or re-run by an unrelated sync write) is served the committed value, publishes at once, entangles nothing, and re-runs at the lane's release; `latest()` and `createOptimistic` sources alike. Only direct reads return the override while the lane holds. Off the lane is provenance, not membership: a pass under the lane's own transaction (its async's landing) is the lane's work.
- Lanes stage (#3479 review): an optimistic derivation is an override. A lane pass on a memo publishes its speculative result as a _derived override_ instead of direct-committing `_value`, so the committed view an outsider sees is a whole frame — the held source and its derivations together, never a committed shadow beside a speculative memo. The revert promotes a derived override the truth confirmed (no re-ask waterfall) and re-derives one it superseded.
- #3463: a reader whose removal is staged in a live transaction (a zombie) is still on screen and keeps holding until the commit that disposes it; it is moot only for that transaction's own verdict.
- #3469 (A30): a pass that changed nothing replaced nothing either — its dependency trim waits on the flush's verdict (`heldTrims`), so a same-value branch switch under a hold still follows its committed inputs.
