---
"@solidjs/signals": patch
---

A store whose own `__proto__` (or `constructor`) data is removed — by `reconcile`, a setter's `delete`, or a projection — now reads `undefined`, as a store that never had the key does, for tracked and untracked readers alike (#4672, core R30). The key's node used to be told the backing's inherited value, so the read served `Object.prototype` wrapped as a store (or `Object`). A tracked reader of an absent pollution key now subscribes like any absent key (R12), so own data landing later reaches it. `__proto__` assignment stays inert.
