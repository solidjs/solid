---
"@solidjs/signals": patch
---

Fix a second write arriving while an async chain is still in flight (#3373, #3374, #3375, #3376).

- A flight's landing now retires only the node's own pending entry. When an input was re-asked mid-flight (`a` restarted while `b`'s first flight was up), `b` stays pending on `a`; the stale landing no longer let the transaction commit the newer signal beside the older derived value (`2 / 1`, #3373) or blip `isPending` to `false` (#3376). A fresh flight drops pending entries its inputs propagated earlier — the run read them, so a masked input (an active override, A17) does not hold it.
- A transaction now tests whether a source's own flight is still up by its self entry rather than `_error.source`, which a later-pending input overwrites; the held write no longer commits ahead of its answer once the load is re-asked under an `on`-scoped boundary (#3375).
- A collecting `Loading` boundary records every source the notifying effect is pending on, not only the one the notification carries — an `on` reset no longer reveals content when the boundary's one collected source settles while the effect is still pending on a flight it already carried (#3375).
- A render effect served a pending node's committed value (the A15 reveal carve-out) joins the transaction's reporters for that node, so a keyed remount that disposes the original reader no longer lets a same-value rewrite commit the held write while the derivation is in flight (`Count: 1` beside `Details: 0`, #3374).
