---
"@solidjs/signals": patch
---

A derived store whose pending first flight is superseded by a synchronous landing now wakes the readers parked on that flight in the same flush, including readers whose store node the landing left unchanged (`"length" in store`, `Object.keys`). A landing staged by a transaction keeps the seed invisible until that transaction commits.
