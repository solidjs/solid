---
"@solidjs/signals": patch
---

`mapArray` commits a structural change without rebuilding full-length copies of its row bookkeeping: a pass stages only the changed window, lands it into the live arrays in place with the unchanged suffix shifted by a loop, and rebuilds only the mapped array that signals the change downstream. A pass that only removes rows is matched with two pointers and no key map, and the key-chain array is sized to the window rather than to the edit's position. One-item inserts and removals on long keyed lists, every-nth removals and sparse filters no longer allocate several list-sized arrays per edit; the strong-abort contract for a mapper that suspends is unchanged, kept by ordering (verify, create, then mutate) instead of by copying.
