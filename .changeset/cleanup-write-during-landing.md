---
"@solidjs/signals": patch
---

A signal write from an `onCleanup` that a transition's landing runs no longer leaves the landed transaction as the next flush's: later transitions commit again instead of parking forever (#4089).
