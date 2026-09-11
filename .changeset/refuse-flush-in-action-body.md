---
"@solidjs/signals": patch
---

Refuse `flush()` inside an action body. An action's writes are held by its transaction until it settles, so a flush can't reveal them — and the drain loop only exits once the ambient transition is cleared, so it parked the transaction mid-slice and every write that followed in the body landed as a plain, committed write, visible before the action finished. DEV now throws `FLUSH_IN_ACTION`; prod skips the drain (the `flush(fn)` form still runs `fn`). The same drain inside `restoreTransition` is skipped when a nested action resumes synchronously inside an outer body, which had the same leak.
