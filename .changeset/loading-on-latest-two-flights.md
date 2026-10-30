---
"@solidjs/signals": patch
---

A `<Loading>` armed by `on={latest(id)}` no longer stays on its fallback for good when another boundary's flight over the same `id` still holds the frame as the armed boundary's own flight lands. The boundary's output pass left the verdict lane inside the held transaction's flush with an answer equal to its committed value, so the equality gate notified nobody, and the lane seam wakes such a pass only when the frame is not held: when the frame landed, nothing re-ran the reader. A pass that leaves a lane the screen has shown while its frame is still held now hands the shown value to `_value` (what the screen shows stays the screen until the landing), so its answer is a change and lands with the frame.
