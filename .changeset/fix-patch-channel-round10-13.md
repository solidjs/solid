---
"@solidjs/signals": patch
---

Round-10.13 audit fixes (structural lifecycle): row-ops/slot dispatches defer into collapsed owner queues per entry and re-derive live state at release via the resync forms (baseline-relative ops would be stale), and consumers registered during a held structural commit receive the settle-time live resync instead of staying permanently stale — never the baseline-relative ops (round-7 exclusion refined, not reversed). The two #3123-coupled landing findings are deliberately deferred while that work settles upstream.
