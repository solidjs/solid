---
"@solidjs/web": patch
---

In the dev build, a live `GET()` grant now survives an SSR program reload that re-evaluates the server module without the module that declared the read: a router's `query()`-declared reads no longer answer 405 until the next document render (#3564). The carried grant is provisional and dispatch-only — the origin gate stays on for that id, so a cross-site GET still answers 403 — until the live binding re-declares `GET()`; a `GET()` on a reference from the earlier evaluation grants nothing and no longer throws. Production builds are unchanged and still revoke the grant on every rebind (#3129).
