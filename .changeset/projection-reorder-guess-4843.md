---
"@solidjs/signals": patch
---

A `mapArray` (or `<For>`) over a `createProjection` of an optimistic list now follows a reorder guess. The projection's new arrangement in the guess's lane was taken as a guess landing on itself, so its readers never heard of it and the list kept the old order, even after the refetch landed (#4843).
