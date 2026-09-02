---
"solid-js": patch
---

Keep ordinary property reads on rejected server projections throwing the original error instead
of exposing seed values, while preserving existing reflection and symbol behavior.
