---
"@solidjs/signals": patch
---

The reconcile walk's patch-emission guards short-circuit on the installed-hooks binding before touching target fields, so stores without any patch consumer pay no per-record loads in the adoption walk (CodSpeed caught −7.7% on the 12k-path listened-paths bench).
