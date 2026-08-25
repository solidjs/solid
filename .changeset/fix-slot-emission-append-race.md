---
"@solidjs/signals": patch
---

Fix shallow slot-patch emission racing row creation: appended positions past a fully-aligned prefix (vacuously aligned when the previous list was empty) emitted slot value-ticks for rows that do not exist yet — the slot queue applies before the row ops that create them, crashing the list driver on clear-then-refill and pure appends. Slots now dispatch only for indices with a previous slot; appends are structure-only. Found by the driver/classic equivalence matrix.
