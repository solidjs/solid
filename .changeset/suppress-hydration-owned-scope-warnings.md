---
"solid-js": patch
---

Suppress dev-mode "owned scope" warnings for internal hydration-gating signals by marking them as pureWrite, and bump @solidjs/signals to 0.13.3 which decouples snapshot exclusion from pureWrite via a new _noSnapshot flag
