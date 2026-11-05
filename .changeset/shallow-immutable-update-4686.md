---
"@solidjs/signals": patch
---

`IMMUTABLE_UPDATE_IN_STORE` no longer reports wholesale replacements on a shallow store, or of a `markRaw` / unwrappable leaf (#4686). Those values are invalidated as a unit, so leaf draft assignment does not narrow who re-runs — the diagnostic's advice does not apply.
