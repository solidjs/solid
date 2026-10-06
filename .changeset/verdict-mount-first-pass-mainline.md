---
"@solidjs/signals": patch
---

A mount made by a verdict reader stays mainline (#3851). Inside an action, `<Show when={latest(x) > 0}>` opens at once, but a `<Loading>` it mounts used to show `content 1` beside the committed `x = 0`: the content's first pass was staged in the verdict lane its creator was in, and in the action's own flush it read the staged `x` before the seam held it. A first pass now takes its creator's lane only for an optimistic lane (head and tail of its pass alike); a first pass that reads a staging of a flush with a transaction is born held like one that read a held node; and verdict-lane work that read the frame's stagings re-derives on the committed world when the frame stays parked. The boundary shows its fallback and `content 1` at the landing.
