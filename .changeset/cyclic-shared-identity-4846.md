---
"@solidjs/web": patch
---

Serializing a value that holds a cycle no longer copies the parts of it that have nothing to replace. An object an async memo answered with and a store also held stayed one object in the hydration data only when the store had no cycle; with one, the client got two copies (#4846).
