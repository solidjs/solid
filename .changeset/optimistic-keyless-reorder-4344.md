---
"@solidjs/signals": patch
---

`createOptimisticStore`: a reorder inside an action of rows without an `id` now shows in `<For>` (keyed and non-keyed) at once, as it already did in direct reads, and reverts on screen at the settle. Rows without a key are compared by their contents at each index: a row with the same contents is the same row (a server echo still confirms, #3898), and a row with other contents is a change of arrangement (#4344).
