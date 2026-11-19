---
"@solidjs/signals": patch
"solid-js": patch
---

`markRaw` is exported from `solid-js` and accepts a class: `markRaw(MyClass)` keeps every instance of the class and its subclasses out of store wrapping. Use it for self-managing objects (their own subscribers, `#private` fields) that a store would otherwise wrap (CS-R48).
