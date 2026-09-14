---
"@solidjs/signals": patch
---

Optimistic frames release when nothing authoritative is left to wait on, and a shared render effect no longer entangles unrelated updates (#3426, #3427, #3407).

- The last async reader of an optimistic value unmounting mid-action releases the frame (#3426): the lane's hold check prunes dead reporters itself (`sourceObserved`, shared with the settle verdict), instead of waiting for a flight nobody observes to land.
- The action body ending starts the correction (#3427): with the bodies over and no authoritative work in flight — no override node's own source, no held plain load the action asked for — each override's truth supersedes it now and the graph re-derives from it as the transaction's held work, settling when that lands. Before, the settle waited for the obsolete lane-derived flight, flashed the obsolete optimistic frame, then reverted and re-asked. A co-written flag stays through a plain load; optimistic store edits keep the settle-then-revert order.
- A render effect's pass belongs to whatever dirtied it (#3407): a sync `action` write to a signal that shared a hole with a held async (`{b()}:{detailsA()}`) merged into the async's transaction and waited (`0:0 → 2:1`) while the same plain write passed through. `recompute` re-enters a stamped node's transaction for memos only; the landing of a flight enters every transaction waiting on it (`enterWaiting`), which is where the effect re-entry's one legitimate job — completing the reveals that discovered the flight — now lives. Two independent flights read in one hole land at their own times.
