---
"@solidjs/web": patch
---

A broadcast live read with a plain form query (`?room=a`, no `?args=`) is now keyed by that query, so viewers of different queries no longer share one source.
