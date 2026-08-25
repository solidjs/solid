---
"@solidjs/web": patch
"@solidjs/h": patch
"@solidjs/html": patch
---

Move frames, server-functions, and serialization implementations into their subpath folders. Bind `@solidjs/h` and `@solidjs/html` directly to `@solidjs/web` instead of taking a runtime argument.
