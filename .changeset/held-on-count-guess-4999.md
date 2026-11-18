---
"@solidjs/signals": patch
---

Under a `Loading` held by `on`, an expression beside a `For` in the boundary's children (a count over the same store) shows a later guess as the list does, while the swap to the fallback stays staged in the hold (#4999).
