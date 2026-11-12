---
"@solidjs/signals": patch
---

fix(signals): a display-ahead `<Show>` keeps its fallback while the write that opened it is held for fragment, text-beside-a-hole and function children, as it does for an element child (S-46, S-58, #4806)
