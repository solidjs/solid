---
"@solidjs/signals": patch
---

fix(lanes): a corrected guess lane voids a staged error with the rest of its staging, so a refresh's failure reaches `Errored` (#4748)
