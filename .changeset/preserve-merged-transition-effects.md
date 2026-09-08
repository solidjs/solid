---
"@solidjs/signals": patch
---

Preserve queued effects when pending actions merge into another transaction, preventing stale DOM output after signal values commit.
