---
"@solidjs/signals": patch
"solid-js": patch
---

`LOADING_ON_OUTSIDE_HOLD` now recommends the structural fix (one hold owns the data, or `isPending()` for the wait) and mentions `latest()` in `on` only as a capability. Docs and JSDoc for `Loading on` updated to match.
