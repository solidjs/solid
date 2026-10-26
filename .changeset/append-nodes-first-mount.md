---
"@solidjs/web": patch
---

First mounts of a multi-node insert go through `appendNodes` again instead of `reconcileArrays` with an empty old list, which cost creation-heavy work (spa-navigation mounts ~3%). The once-per-pass focus read from #4261 is shared between the two, so a focused node arriving from another list still keeps its focus.
