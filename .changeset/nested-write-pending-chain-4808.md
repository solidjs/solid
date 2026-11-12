---
"@solidjs/signals": patch
---

fix(store): a store setter writing a nested key inside another store that is still loading its first answer no longer throws `NotReadyError`. The nested write is dropped, as a write to a loading store is replaced by its first answer, and the outer store keeps following the inner one. Dev warns with `STORE_WRITE_THROUGH_LOADING` (#4808).
