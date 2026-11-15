---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

A controlled input no longer loses typed text when its signal write is held (an async derivation of it is pending) and another binding in the same template re-runs, such as a sibling `isPending` class flipping: a stateful DOM prop (`value`, `checked`, …) in a grouped effect or a spread skips an unchanged write while the effect is a stale reader of an open hold, and the hold's landing writes the bound value (#4872). Outside a hold every run still writes (#2016, #4186).
