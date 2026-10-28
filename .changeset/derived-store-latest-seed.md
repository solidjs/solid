---
"@solidjs/signals": patch
"solid-js": patch
---

A derived store whose derive reads an async memo through `latest()` no longer shows its seed for one pass after it first resolves: a memo (or a second derived store) reading it now sees what the derive wrote, so a render effect downstream commits only the real value, the same as one reading the store directly (#4355).
