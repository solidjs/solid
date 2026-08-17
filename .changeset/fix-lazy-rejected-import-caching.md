---
"solid-js": patch
---

lazy() no longer caches rejected module promises: a failed chunk download retries on the next mount or preload() on the client (so Errored reset() flows work, matching the platform's re-fetch of failed dynamic imports), and a transient import failure on the server no longer poisons every subsequent SSR request for the process lifetime. Failed loads also no longer surface as unhandled rejections. (#2999)
