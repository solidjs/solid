---
"@solidjs/compiler": patch
---

A module constant read by a component the refresh pass hoisted above it folds into the template as it does without the refresh pass, so the dev client and the server agree on the hole and hydration no longer crashes (#4791).
