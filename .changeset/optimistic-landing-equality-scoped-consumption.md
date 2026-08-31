---
"@solidjs/signals": patch
---

Optimistic store landings now consume structural overrides only when they contradict them (#3123). An interim landing carrying data equal to the base an optimistic edit was applied on (an unchanged poll) no longer flash-reverts the edit — the override holds with its owning transaction and still reverts at settle if the server never confirms. Landings that actually change the target's arrangement (array index/length, object membership) consume as before.
