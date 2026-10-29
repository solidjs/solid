---
"solid-js": patch
---

Stop a `createRoot` dispose function from retaining the root's `fn`. The dispose function shared `createRoot`'s scope, so holding it kept `fn` and everything `fn` closes over alive: every `mapArray`/`indexArray` row (and so every `<For>`/`<Index>` row) kept the list it was created from, including items later removed from it.
