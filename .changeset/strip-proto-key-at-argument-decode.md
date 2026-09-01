---
"@solidjs/web": patch
---

Decoded server-function arguments no longer carry `__proto__` as an own key (#3168). Both decode roads (plain JSON and the codec) preserved the key faithfully, so an ordinary `Object.assign` merge in a handler re-prototyped its result with attacker-supplied data. The key is now stripped recursively at the argument-decode seam, covering plain objects, arrays, and revived Map/Set entries, with cycle protection.
