---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Assign bare variable refs inside `ref` arrays. `ref={[el]}` type-checked and
compiled but `el` was never assigned: the array branch passed the array
straight through, and the runtime only *calls* ref-array entries (a bare
variable evaluates to `undefined` at mount, so it was silently skipped).
Bare identifiers and member expressions inside a ref array are now lowered
to assignment callbacks — read the target once, call it with the element
when it holds a function, otherwise assign the element — matching the
non-array `ref={el}` contract. Nested arrays are recursed, callback refs
and const/module refs pass through untouched, and falsy slots
(`null`/`undefined`/`false`) keep short-circuiting.
