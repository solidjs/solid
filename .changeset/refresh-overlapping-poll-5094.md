---
"@solidjs/signals": patch
---

`refresh()` called while the same question's answer is still out no longer drops that answer (#5094). It waits for the answer to land, then re-asks once, however many times it was called meanwhile. Polling on an interval shorter than the response time now shows each answer, and other changes no longer wait behind the poll. A `refresh()` inside an action still re-asks at once in the action's hold.
