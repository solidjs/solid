---
"@solidjs/signals": patch
---

Fix `createOptimisticStore` writes not reverting after a failed action while the attribution engine is enabled (#3687). The `OPTIMISTIC_REVERTED` check called the node's comparator detached from the node; store slot nodes share one comparator that reads `this._host`, so the check threw inside the settle before the drop notified subscribers. The comparator is now invoked as the node's method.
