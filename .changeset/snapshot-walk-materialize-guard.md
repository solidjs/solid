---
"@solidjs/signals": patch
---

Internal: the snapshot walk drops a redundant overlay guard before materializing a pending backing (`materializePB` already returns the backing unchanged without an overlay). No behavior change.
