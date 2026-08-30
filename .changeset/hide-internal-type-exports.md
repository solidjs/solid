---
"solid-js": patch
---

Stop exposing generated declaration files through `solid-js/types/*`. Public values and types remain available from `solid-js`; keeping implementation declarations private also prevents TypeScript from suggesting invalid runtime imports such as `solid-js/types/server/signals.js`.
