---
"@solidjs/compiler": patch
---

A `"use server"` function declaration nested inside another function is now extracted like any other server function.

- Previously the directive on a nested declaration was silently ignored: the body shipped to the client and ran there, while captures from the enclosing function were still rejected at compile time.
- The declaration is hoisted to a `const` at the top of its block, so calling it before its source position still works.
- Its id follows the binding path, such as `outer.inner`.
