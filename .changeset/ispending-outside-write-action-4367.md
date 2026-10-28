---
"@solidjs/signals": patch
---

`isPending(s)` read through a memo (`<Show when={isPending(s)}>`, a compiled ternary's condition) no longer stays `true` after an action completes when `s` is also written outside the action (#4367). The outside write that matches the action's value ends the verdict, and the memo's pass leaves the verdict lane on a value equal to its committed one, so the equality gate notified nobody; the lane seam woke the reader that still showed the lane's `true` only when the lane's frame was not held, and the action held it. A pass outside any transaction's flush is the screen's: its readers now re-derive at the seam, as the inline `isPending(s)` does.
