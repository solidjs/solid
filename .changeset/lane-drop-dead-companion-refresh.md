---
"@solidjs/signals": patch
---

Drop the lane source's redundant `isPending` companion refresh on derived pending/settle; the verdict never depended on it and the source's own paths keep it current.
