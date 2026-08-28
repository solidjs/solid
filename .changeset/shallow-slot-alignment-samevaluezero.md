---
"@solidjs/signals": patch
---

The shallow branch's slot-alignment prefix compares keys with SameValueZero: strict equality broke alignment on NaN keys, suppressing the slot's value ticks while the ops builder retained the row — a permanently stale DOM row (found by a full-surface self-sweep of every key-comparison site).
