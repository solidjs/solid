---
"@solidjs/signals": patch
---

Route errors thrown while applying asynchronous computed setters through the
node's error state. This prevents user callbacks invoked during asynchronous
projection reconciliation, such as key selectors, from escaping as unhandled
promise rejections.
