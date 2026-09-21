---
"@solidjs/web": patch
---

In the dev build, a live `GET()` grant follows its id when the server module is evaluated again without the module that declared the read: a router's `query()`-declared reads no longer answer 405 after an SSR program reload until the next document render (#3564). Production builds still revoke the grant on every rebind (#3129), and a stale grant is never carried.
