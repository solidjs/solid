---
"@solidjs/signals": patch
---

A lane now holds through a `Loading` boundary showing content: a boundary output forwarding its tree's pending counts as a frame reader, so `latest()` no longer reveals beside the boundary's stale content (A33). An output that never committed — a mount the frame has not revealed — holds nothing. A corrected guess that never showed is void at the correction: untracked reads return the committed value (A18 amendment, 2026-10-05).
