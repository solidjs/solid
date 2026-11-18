---
"@solidjs/signals": patch
---

Rewriting a held signal with its current value outside a flush no longer schedules a flush. An observer that rewrote its state after every flush (such as `DevToolbar` during an action that calls `refresh`) kept the microtask queue busy, so the action's pending request never resolved and the tab stopped responding (#5038).
