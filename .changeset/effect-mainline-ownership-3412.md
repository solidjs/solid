---
"@solidjs/signals": patch
---

Keep a mainline-computed effect value out of a parked transaction. When an effect stamped by a held transaction recomputed on an unrelated write and no longer read the held source, the forced re-run inside that transaction re-claimed ownership of the value it had just published. A finalize-time re-entry (a `Loading` boundary's `on` reset flipping its fallback state) then parked the effect with the transaction, leaving a `show() ? details() : "hidden"` reader stale until the unrelated async settled (#3412).
