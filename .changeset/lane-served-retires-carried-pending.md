---
"@solidjs/signals": patch
---

fix(signals): lane work re-based over a held change's answer reads that change's world in every flush and is not re-derived on the committed world while it is parked, so a refresh or a second entangled change no longer commits a derivation over the old inputs beside the new ones, and the held change lands once its last async answers (#4576, #4577)
