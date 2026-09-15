---
"@solidjs/signals": patch
---

A `Loading` boundary whose `on` resets keeps its fallback until every reader under it has settled, not only the ones that notified after the reset (#3459).

- The reset clears the boundary's collected sources and re-collects from the pending notifications that follow. A reader already pending from an earlier write never re-notifies (status propagation dedupes on its `_pendingSources`), so a sibling reader's fresh flight was the only source collected, and its landing revealed the still-flying one stale: `B: 1 | Fast: 1 | Slow: 0` for two seconds. The reset now also harvests what its forwarded readers still wait on from the live transactions' `_asyncReporters` (INV-3, the one record of a forwarded reader), so the hold the #3375 ruling takes off the lane lands on the boundary instead: `B: 1 | Loading`, then `Fast: 1 | Slow: 1` together.
