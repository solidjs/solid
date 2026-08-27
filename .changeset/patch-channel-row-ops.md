---
"@solidjs/signals": patch
---

Stage 2 (PR-B): row ops. The keyed adoption walk emits structural list ops
(`registerRowOps`: prefix, sources, removed) through the same apply queue as
record patches — aligned value ticks emit nothing; consumers apply minimal
DOM moves via one LIS over data ops instead of re-deriving moves from DOM
node arrays. Measured on dbmon: sort 10.7 → 4.5ms, remount 25.7 → 9.3ms
(octane 4.0/8.5), while ticks stay ahead (3.0/0.9 vs 3.2/1.3).
