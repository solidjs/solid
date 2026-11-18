---
"@solidjs/signals": patch
---

fix(signals): a reader linked to a settled source no longer stays pending on it, so an action whose reader waits on a derived optimistic store and a slower sibling flight lands
