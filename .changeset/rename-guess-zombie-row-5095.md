---
"@solidjs/signals": patch
---

After a list's re-ask fails while other re-asks are out, a fresh guess on one of its rows now shows in the `For` row as it does in a memo over the same row. The old row stays on screen as a zombie seated in another action's lane, and the guess now re-stages it too.
