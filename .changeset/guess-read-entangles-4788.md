---
"@solidjs/signals": patch
---

A guess an action writes after reading another action's live guess, in its body or its setter, now entangles the two actions: neither guess reverts while the other action is out (#4788).
