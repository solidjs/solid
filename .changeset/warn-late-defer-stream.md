---
"@solidjs/web": patch
---

Warn in development when a `deferStream` value is created after the SSR shell has already flushed, because it cannot delay that response and will stream normally (#3299).
