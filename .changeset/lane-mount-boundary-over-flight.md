---
"@solidjs/signals": patch
---

A `Loading` mounted by an optimistic write over a flight shows its fallback again (#3835's seat regressed it). Lane work with no committed value yet reads a pending flight the way a mainline mount's memo does: it enters and throws, so the boundary it mounts catches the pending (A29's boundary exemption), instead of being served the flight's committed value. A render effect is still a stale reader of a held flight (rule 3). Approach and tests from #3843 by @brenelz.
