---
"@solidjs/signals": patch
---

A store proxy over an array subclass or a class instance keeps the source's prototype: `instanceof`, `Object.getPrototypeOf` and `.constructor` answer as they do on the source, also after a write and in a projection's derive (#4670). Reading an inherited `constructor` on a draft still returns `undefined` (the prototype pollution guard).
