---
"@solidjs/signals": patch
---

An error boundary whose content returns a store row, read through a memo or directly, now catches the store's failed re-ask and shows its fallback. Before, the failure escaped the boundary and halted the app with `REACTIVITY_HALTED`.
