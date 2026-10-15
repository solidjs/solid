---
"@solidjs/web": patch
---

frames: the trace tier's update-site wait. A MOUNTED occurrence's new slot record whose args carry a `{ $tr }` container-trace marker while the trace tier is absent (a live slot op minting the page's first trace after the shell, a refetch adding a projection arg) now stays pending in the store: the live binding keeps the args it shows, the tier load starts, and the install's flush applies the record as an args change with the marker materialized. Before, `#syncSlots` guarded only the fresh mount (`needsTrace`) and the regions tier at the update site (`needsRegions`), so such a record was pushed into the live binding raw — the marker read as the value. Mirrors the regions tier's update-site wait.
