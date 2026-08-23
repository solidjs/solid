---
"@solidjs/signals": patch
---

`latest()` now returns the in-flight value when first called during a held transition. The latest-value companion is created lazily, and a write processed before its creation was never pushed into it, so the first `latest()` read inside a transition (e.g. a pending banner gated on `isPending()`) showed the committed value until the next write. The companion now backfills the pending value on creation, matching `isPending()`.
