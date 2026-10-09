---
"solid-js": patch
---

Preserve mounted context IDs during hot module evaluation, before another module can refresh a consumer. Previously a consumer refreshing before the context module's accept callback could throw `ContextNotFoundError` or read the context's default instead of the provided value. Unmounted context registrations retain fresh IDs for entry-module remounts.
