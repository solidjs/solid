---
"@solidjs/signals": patch
---

fix(signals): a re-parked reader drops a pending source that was disposed while loading, so a hold whose owner re-ran and replaced that source lands, and a staged error reaches its boundary
