---
"@solidjs/signals": patch
---

`IMMUTABLE_UPDATE_IN_STORE` no longer reports an array index that now holds an item the array already had, such as the next item shifted down by an in-place `splice` (the repair the diagnostic recommends). Before, if the removed item and its neighbour shared at least half of their leaves, the move was reported as a spread-copy replacement (#4262). A fresh copy assigned to an index is still reported. Production output is unchanged.
