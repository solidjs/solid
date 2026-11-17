---
"@solidjs/signals": patch
---

fix(signals): an async derivation's read of a verdict memo no longer seats that memo in the hold, so a write in `onSettled` after hydration is not held forever (#4965)
