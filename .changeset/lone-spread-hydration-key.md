---
"@solidjs/compiler": patch
"@solidjs/babel-plugin": patch
---

A lone dynamic spread on an SSR element (`<label {...props()} />`) now defers behind a thunk like a spread beside other attributes, so it runs after the element's hydration key. A spread that created a memo shifted the element's key on the server only, and hydration missed the element (#4240).
