---
"@solidjs/signals": patch
---

Fix a type error in refresh()'s quiescence waiter that broke declaration emit (`pnpm types`): the waiter captured inside the effect's own compute is the effect node, so it is typed `Computed` rather than `Owner`, matching what `dispose()` takes. Type-only; no runtime change.
