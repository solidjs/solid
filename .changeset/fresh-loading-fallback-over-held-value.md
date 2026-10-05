---
"@solidjs/signals": patch
---

A fresh `<Loading>` mounted over a held value shows its fallback now and reveals its content at the hold's commit again (#3540). Inside a flush, a first pass under a loading boundary that has not shown content no longer makes the whole flush join the hold, so the `<Show>` that mounted it opens now; and content whose bindings (not the boundary's own tree) read the held value is caught by the boundary instead of rendering empty.
