---
"@solidjs/web": patch
---

Frames client: the adopt-time slot walk reads the server's tier announcement for the scan, not only the load — a page whose `sc:tiers` record names other tiers and not `bind` is never scanned for binding-slot markers (`_s:*`), and the bind tier is never loaded for it; an un-announced page keeps detection. `collectSlots` is one TreeWalker pass over comments (and elements only when markers may exist), testing a comment's data by prefix before any regex. Same slots found, in the same order; no public API change. Measured on the HN story page (652 occurrences, 17k comments): `collectSlots` 14.2 → 5.4 ms.
