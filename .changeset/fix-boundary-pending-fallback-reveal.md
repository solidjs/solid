---
"@solidjs/signals": patch
---

A Loading boundary whose fallback reads something not ready now reveals its content as soon as the content lands, instead of waiting for the fallback's own flight (#3540). The boundary's output pass derives from its `_disabled` switch, not its tree, so only the boundary sweep re-runs it — and that sweep ran at the commit, after the verdict the output's own pending read kept parking. Such a boundary is now judged before the verdict, under the transaction, so its output re-runs, reads the tree and drops the fallback's read ahead of the verdict. Boundaries whose fallback is ready are unaffected.
