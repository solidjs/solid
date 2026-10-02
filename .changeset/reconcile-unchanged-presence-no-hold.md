---
"@solidjs/signals": patch
---

A store fold's presence notification (`in` subscribers) now compares the old and new presence of each observed key before writing the node, as the value notification already does. Repeating an unchanged presence joined the node's holding transaction before the equality gate rejected it, so a `reconcile()` outside an action that had deleted an observed key held every other node in that tick (`a.value` stayed stale until the action settled, #3743). A real presence change still notifies and still proposes on a held node.
