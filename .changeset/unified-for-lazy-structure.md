---
"@solidjs/web": patch
---

Unified For slot: lazy structure — first fills carry no Row objects, chain, or key map (parallel arrays, mapArray's mount economics); the structure materializes once, on the first partial structural op. Aligned lists, clears, and no-survivor replaces stay flat forever. Removes the slot's creation regression: armed jfb-signal run/runlots at classic parity with the structural wins retained (geomean 0.638 vs baseline, gates green).
