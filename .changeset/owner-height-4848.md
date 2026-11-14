---
"@solidjs/signals": patch
---

A computation now runs after every computation that owns it, not only its direct owner. A binding nested under a `<Show>` branch (or the ternary it lowers to) no longer runs before the branch closes once the condition starts reading a deeper memo, which threw "Stale read from <Show>." and halted updates (#4848).
