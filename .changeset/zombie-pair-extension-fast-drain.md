---
"@solidjs/signals": patch
---

Move zombie staging (pending disposal/children) into the cold node extension and add a plain-commit fast drain to flush. Childless memos never touch staged disposal, the per-recompute commit gate is one null check, and flushes with nothing but pending value commits skip the full scheduler spine. update1to1 -12% and dbmon deep tick -11% on top of the extension split.
