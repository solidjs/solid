---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

DOM output: an element's `ref` now runs after its attributes and spread are applied, and still before its children. A ref's own attribute writes now survive client creation the way they already survived hydration (#3685).
