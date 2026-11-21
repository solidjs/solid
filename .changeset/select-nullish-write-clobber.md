---
"@solidjs/web": patch
---

A `<select value>` set in the same turn after an unset (`null` or `undefined`) value now keeps the new selection instead of being cleared by the earlier unset write.
