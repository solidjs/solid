---
"@solidjs/signals": patch
---

Keep traversing sibling effect queues when a flush disposes queues mid-pass. An effect can dispose an owner, and disposal removes queues from the parent's child list — the running child itself, an earlier sibling, or several at once when one root owns multiple boundaries. The index walk then skipped whatever shifted into the cursor, leaving those effects unexecuted with no later flush scheduled. Each child is now stamped with the current pass before it runs, so the traversal can rescan after a shift and still run every child exactly once; children appended mid-pass still run, as before.
