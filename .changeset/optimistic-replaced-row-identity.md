---
"@solidjs/signals": patch
---

`createOptimisticStore`: when a guess puts a different row object at an index, `<For>` (keyed and non-keyed) now picks up the new row at once and goes back at the settle, the same as direct reads. Before, `<For>` kept the old row if the new one had the same `id`, or, for rows without an `id`, the same contents or any contents in a reorder (#4344). An edit to that row then showed in direct reads but not on screen. A row the store already serves is now compared by the row it is, not by its key or contents. A server echo still confirms the guess.
