---
"@solidjs/signals": patch
---

`OBSERVE.exclude` now covers writes: a root write to an excluded subject (the observer's own store or signal) no longer counts toward the interaction that made it, and an interaction whose writes all went to excluded subjects with none of the app's work run — a click on a devtools panel's own button — is not recorded. Store nodes carry the owner their store was created under, so an excluded panel's store is an excluded subject like its signals.
