---
"@solidjs/signals": patch
---

A `<Loading on>` boundary no longer shows its fallback when a held `on` change commits under an action's own `refresh()` (#4379). When an `on` change is held with an action (an input changed under its optimistic guess, #4336) and the content's new answer lands inside that hold a flush after the change, the boundary now folds the staged fallback back, as it already did when the content was ready at the change. The action's commit shows the content, and the quiet `refresh()` that follows keeps it on screen until it answers.
