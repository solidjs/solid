---
"@solidjs/signals": patch
---

Stage-3 opener: hot-path shape alignment. Optional-machinery slots read on
every write/recompute/commit (_overrideValue, companions, _snapshotValue,
_optimisticLane, _error/_blocked/_pendingSources/_notifyStatus) are now
present-with-default in the node literals or gated by presence bits on the
always-present _config (CONFIG_OPTIMISTIC / HAS_COMPANIONS / HAS_SNAPSHOT /
HAS_LANE) — missing-property megamorphic reads are gone from setSignal,
insertSubs, commitPendingNode and recompute's status gate, and
optimisticSignal/optimisticComputed no longer fork hidden classes post-
construction. Measured ~7-10% on write-path microbenches; core-floor size
ceiling consciously bumped ~120B.
