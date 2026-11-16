---
"@solidjs/signals": patch
---

A row moved into a keyed optimistic store before that store's first answer, then renamed there, shows the store's last answer once everything lands again (#4918, a regression from the #4907 fix). A returned answer was paired with a row lent by another store, which made that store's row stand in the slot, so later answers of this store went past it. A returned answer is reconciled against the rows on screen, which already include the lent row, so it now skips that pairing. A derive that writes its draft keeps it.
