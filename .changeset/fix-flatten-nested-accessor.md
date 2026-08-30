---
"@solidjs/signals": patch
---

Preserve deferred unwrapping when a nested array follows an accessor during children flattening. Universal renderers now receive resolved host nodes instead of raw accessor functions for this child ordering.
