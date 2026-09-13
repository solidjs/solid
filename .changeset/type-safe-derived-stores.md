---
"@solidjs/signals": patch
"solid-js": patch
---

Require complete explicit seeds for derived stores, preventing required properties from being absent at runtime while exposed as present in the store type. Object projections may instead omit the seed and use a return-only initializer that supplies a complete value on every resolution; array projections continue to require an explicit seed.
