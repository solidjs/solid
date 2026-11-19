---
"solid-js": patch
---

Diagnostics guidance: a top-level `untrack` snapshot is only safe when the value is never downstream of async (an async-derived value can be pending or mid-transition).
