---
"@solidjs/web": patch
---

First mounts of a multi-node insert skip `reconcileArrays`' diff setup (spa-navigation mounts ~3%). The once-per-pass focus read from #4261 still applies, so a focused node arriving from another list keeps its focus.
