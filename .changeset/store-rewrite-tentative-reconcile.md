---
"@solidjs/signals": patch
---

Store rewrite: tentative reconcile channel and affects integration. A
user-context reconcile on an optimistic store now parks as engine overrides
(values, membership, length) instead of committed adoption — key-matched rows
keep proxy identity via descent, and everything reverts with its transaction.
Fixes FINDING-2 (a key added by an in-window reconcile now reverts at settle).
The affects/marks system covers next-store targets, including optimistic rows
in motion at declaration time.
