---
"solid-js": patch
---

An SSR owner disposed while the owner pool is full now drops its render's context too, so a stale reference to a reused owner no longer keeps later renders alive.
