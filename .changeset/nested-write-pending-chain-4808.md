---
"@solidjs/signals": patch
---

Dev: a store setter writing a nested key inside another store that is still loading its first answer now reports `STORE_WRITE_THROUGH_LOADING` before the setter throws the read's `NotReadyError`, naming the key and the whole-value replacement that works (#4808). No production bytes.
