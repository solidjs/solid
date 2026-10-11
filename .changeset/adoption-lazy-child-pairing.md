---
"@solidjs/signals": patch
---

A derived store row first read during a held adoption is paired with its old row the way the adoption pairs rows (by the family's key), so reading a field the adoption left unchanged (`cards.find(...)?.id`) no longer holds an independent write for the action's lifetime (#3712). A changed field still holds.
