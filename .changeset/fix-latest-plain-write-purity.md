---
"@solidjs/signals": patch
---

Fix `latest()` purity: probing a memo that itself uses `latest()` no longer leaks a queued plain write into committed reads before the flush (#3009). Wake-only companion lanes pulled mid-tick now demote to plain staged recomputes.
