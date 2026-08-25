---
"@solidjs/signals": patch
---

Fix pending-gated readers stranded one value behind after a transaction landing. A reader gated on `isPending` that first reads its async source during the landing flush was served the committed old value under the companion's lane, and the staged value then promoted silently — `laneReadsCommitted` now records such readers into the active transaction's gated-subs for the existing post-commit replay (#2963 contract). Also fix a `latest()` shadow disposed at a landing swallowing the next transition's value: a disposed shadow is treated as absent and recreated on access, and an optimistic write no longer equality-compares against a dirty node's stale value.
