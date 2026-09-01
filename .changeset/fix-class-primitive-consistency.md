---
"@solidjs/web": patch
---

Handle primitive class values consistently between static, dynamic, and array forms (#3189). Dynamic numeric class values now stringify like the compiler's static template output on both client and server, and standalone booleans inside class arrays are ignored per clsx-style composition instead of emitting a literal "true" class.
