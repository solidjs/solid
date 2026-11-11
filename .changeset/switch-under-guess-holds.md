---
"@solidjs/signals": patch
---

A plain write made while an optimistic guess is out now waits for the async it needs, even when the memo that needs it is the guess's lane work. Before, that memo got the old async result alongside the new value. For example, a filter switch showed "closed" with the open rows until its fetch answered, both through a keyed projection and under a `<Loading on>` boundary, which also dropped the guess from the screen. The screen now keeps what it showed, an armed `<Loading>` shows its fallback, and the switch lands with the fetch's answer.
