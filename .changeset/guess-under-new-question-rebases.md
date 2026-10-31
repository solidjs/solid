---
"@solidjs/signals": patch
---

A keyed optimistic store's arrangement guess written while its derive asks a new question (an input changed, not a `refresh()`) is re-based over that question's answer, like an older truth (#4525). Before, the answer folded beneath the guess, so the rows the guess had only carried over from the old answer stayed on screen; under `<Loading on={filter()}>` the region left its fallback showing the new input beside the old list minus the guess until the action's refresh landed.
