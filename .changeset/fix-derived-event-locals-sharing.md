---
"@solidjs/web": patch
---

Direct (SSR-time) server-function calls now run under a per-call shallow copy of the render's `locals` instead of sharing the object: concurrent calls no longer overwrite each other's (and the render's) per-request context. Reads still inherit everything middleware set, and nested objects stay shared by reference; `event.response` remains deliberately shared (#3156)
