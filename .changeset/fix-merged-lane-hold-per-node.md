---
"@solidjs/signals": patch
---

Fix optimistic lanes merged through a shared reader releasing their reveal while one member's async is still in flight (#3335). A lane's hold is a property of each pending async node — looked up in whichever live transaction observed it — not of the merged root's transaction, which after a cross-transaction merge recorded only one member's observations. A memo reading two optimistic values now reveals with both, as it does for plain signals (A15).
