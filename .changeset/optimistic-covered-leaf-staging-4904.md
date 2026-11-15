---
"@solidjs/signals": patch
---

A row moved into a keyed optimistic store that had just emptied no longer reads as `undefined` once every answer has landed (#4904). A reader of an index made while the guess was out (`rows[0]`) was born holding the emptied answer staged beneath the guess. The later landing that brought the row back only recorded its value on the leaf, since the guess covered the key, so the hold's commit put the older, empty answer back when the guess ended. A covered leaf's staging now takes the newer truth too.
