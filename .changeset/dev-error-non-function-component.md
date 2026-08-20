---
"solid-js": patch
---

Dev mode now throws a descriptive error when a JSX tag's component resolves to a non-function (e.g. a missing or misnamed import resolving to `undefined`), instead of crashing inside the dev build with `Cannot read properties of undefined (reading 'name')`. Client dev builds only — zero production cost.
