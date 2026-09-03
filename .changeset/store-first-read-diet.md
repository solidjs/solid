---
"@solidjs/signals": patch
---

Store first-read diet: the get trap's accessor probe verdict threads through to node creation (one descriptor scan per first read, not two), the trap's duplicate node-map lookup is hoisted, and the first tracked read populates the wrap cache so the second read skips wrapNext. dbmon mount min −4%, get-trap self-time −19%.
