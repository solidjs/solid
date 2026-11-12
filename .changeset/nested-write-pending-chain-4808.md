---
"@solidjs/signals": patch
---

fix(signals): a store setter writing a nested field through another store that is still loading writes its seed instead of throwing NotReadyError (#4808)
