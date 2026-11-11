---
"@solidjs/signals": patch
---

A plain write made while an optimistic guess is out now waits for the async it needs, even when the memo that needs it was the guess's lane work. Before, that memo was served the old async result beside the new value. For example, a filter switch showed "closed" with the open rows until its fetch answered. The memo now counts as a reader of the fetch: the screen keeps what it showed, and the switch lands with the fetch's answer.
