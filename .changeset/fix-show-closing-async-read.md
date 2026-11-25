---
"@solidjs/signals": patch
---

Defer lane-dirty zombies whose mainline owner is closing unheld and skip lane-owned zombies in `deferredZombies`, fixing stale-read halts in `<Show>` / `<Match>` when closing overlaps an async hold (#5160).
