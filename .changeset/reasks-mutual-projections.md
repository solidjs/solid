---
"@solidjs/signals": patch
---

fix(signals): `reasks()` no longer recurses forever when two keyed projections each read a row lent from the other's store (#4969)
