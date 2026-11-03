---
"@solidjs/signals": patch
---

A store whose own `__proto__` data is removed — by `reconcile`, a setter's `delete`, or a projection — now reads `undefined`, as a store that never had it does, for tracked and untracked readers alike (#4672, core R30). The key's node used to be told the backing's inherited value, so the read served `Object.prototype` wrapped as a store. Tracked readers are notified of the change; `__proto__` assignment stays inert.
