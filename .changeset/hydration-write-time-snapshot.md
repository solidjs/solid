---
"@solidjs/signals": patch
---

Hydration: a write during snapshot capture to a plain signal that has no snapshot — one created before `hydrate()` began, such as module-level state minted from `onSettled` during the pass — now records the pre-write value as its snapshot and is held like any other write. Readers inside the hydrating scope keep serving the value the server rendered with and replay at scope release; readers outside see the write live. Previously such a write cascaded through the claim pass (whose DOM writes are skipped) and was lost, and a component rendered later in the same pass read a value the server never had. Computeds landing async values and projection leaves are excluded, matching the creation-time capture rules.
