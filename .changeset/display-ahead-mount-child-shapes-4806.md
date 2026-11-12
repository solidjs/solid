---
"@solidjs/signals": patch
---

fix(signals): a display-ahead `<Show>` (or ternary) keeps its fallback while the write that opened it is held, whatever the child's shape: element, fragment, text beside a hole, function child, or plain text (S-46, S-58, #4806)
