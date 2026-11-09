---
"@solidjs/signals": patch
---

fix(signals): a re-parked node drops pending sources its pass no longer reaches, so a `<Loading>` whose first answer was superseded while a sibling refetched reveals once both settle (#4541)
