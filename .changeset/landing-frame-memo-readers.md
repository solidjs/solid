---
"@solidjs/signals": patch
---

At a hold's landing, a memo that read the screen while the hold was up (for example `[latest(x), x()]` or `isPending` beside a held write) no longer shows its stale value for one frame. The runs of its readers that were held with the landing now re-run on its re-derived value.
