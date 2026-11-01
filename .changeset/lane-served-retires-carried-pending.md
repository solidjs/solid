---
"@solidjs/signals": patch
---

fix(signals): a lane pass served the committed value of a refreshing source retires that source's pending from the readers it carried it to, so a held change commits once its last async answers (#4576)
