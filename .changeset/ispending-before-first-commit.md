---
"@solidjs/signals": patch
---

`isPending()` on an optimistic node whose own source landed a value differing from the displayed override now reads `true` even when the node has never committed (its first landing was held by a reveal that never landed). The verdict's uninitialized suppression — A19 exception (1), "no observable value exists" — no longer applies under a displayed override, which is an observable value (A18 d).
