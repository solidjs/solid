---
"@solidjs/signals": patch
---

`createRegion`: fused region creation — one call resolves the target, ensures the version node, and subscribes without running the initial commit (the caller's DOM build is the initial state). Prototype surface.
