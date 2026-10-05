---
"@solidjs/signals": patch
---

A born-held render effect re-run as lane work (a `latest()` reader remounted during an action's hold) re-stages its value, so the commit applies the latest pass instead of the stale born-held one (fuzzer F13).
