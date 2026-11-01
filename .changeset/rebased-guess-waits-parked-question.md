---
"@solidjs/signals": patch
---

fix(signals): a guess re-based over a question's answer stays off the screen while that question's transaction is parked on another read, so the old question never shows beside the new answer's rows (#4559)
