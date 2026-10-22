---
"@solidjs/signals": patch
---

A reconcile or derived-store adoption that receives the same raws swapped, reordered or shifted (`{ x: A, y: B }` → `{ x: B, y: A }`, an unkeyed `[A, B]` → `[B, A]`, `[A, B, C]` → `[B, C, D]`) no longer aliases two slots to one row. A raw that is already a row keeps its proxy at the slot it moved to, a row is paired with at most one slot of the incoming frame, and a raw whose row was paired away to another slot wraps fresh. Before, the slots read each other's values after the commit (#4001).
