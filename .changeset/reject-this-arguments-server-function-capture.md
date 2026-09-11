---
"@solidjs/compiler": patch
---

An arrow marked `"use server"` that reads `this` or `arguments` is now a compile error instead of silently breaking at runtime.

- The arrow is extracted to module top level, where `this` is undefined and `arguments` does not exist.
- A marked `function` is unaffected, and so is any `function` or class nested inside the server function.
