---
"@solidjs/compiler": patch
---

A `"use server"` directive on a method, getter, or setter is now a compile error instead of being silently ignored.

- Those forms are never extracted, so the body kept running wherever it was called, browser included.
- Covers object literal methods and accessors, and class methods, accessors, and constructors.
- Assign a function to a property instead, which the pass does extract.
