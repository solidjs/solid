---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Fix hydration IDs for reactive lone spreads. Hydratable SSR output now defers `mergeProps` until after the element key, which matches DOM output. Static and non-hydratable lone spreads keep the direct path.
