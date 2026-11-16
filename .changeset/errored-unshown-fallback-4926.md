---
"@solidjs/signals": patch
---

fix(signals): an error boundary whose fallback was never on screen lets a pending retry through to the fresh loading boundary above it, instead of keeping a stale error (#4926)
