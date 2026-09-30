---
"@solidjs/web": patch
---

Server `serialize` checks its own render's closed state instead of the global context, so a `renderToString` finishing during another request's stream no longer drops that stream's later hydration records
