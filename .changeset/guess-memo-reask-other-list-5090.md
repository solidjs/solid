---
"@solidjs/signals": patch
---

A memo over an optimistic store now shows a fresh guess at the same moment as a binding over the same row, even when the memo also reads another list whose `refresh()` is still out (#5090). Before, the list row showed the guess while the memo kept the old value until the other list answered.
