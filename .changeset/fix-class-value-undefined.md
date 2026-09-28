---
"@solidjs/web": patch
"@solidjs/h": patch
---

Fix `class` object values rejecting `undefined` at the type level. `ClassValue`'s record form was `Record<string, boolean>`, so `class={{ active: props.active }}` with an optional prop did not type-check, which 1.x `classList` allowed. The runtime already treats `undefined` as off.
