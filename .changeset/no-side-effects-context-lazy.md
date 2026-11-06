---
"solid-js": patch
"@solidjs/signals": patch
---

Mark `createContext`, `lazy` and `lazyModule` with `/*#__NO_SIDE_EFFECTS__*/` so bundlers can drop a call whose result is never used, along with the dynamic import it wraps.
