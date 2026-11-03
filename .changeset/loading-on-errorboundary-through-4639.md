---
"@solidjs/signals": patch
---

An error boundary output read only behind fallbacks now holds nothing when it reaches them through a memo or another error boundary built outside the `<Loading>`, or is not read at all; `LOADING_ON_OUTSIDE_HOLD` no longer fires while the re-armed fallback is on screen.
