---
"@solidjs/signals": patch
---

perf: optimize reactive hot paths

- O(1) dependency revalidation: replace the `isValidLink` dep-list scan with a
  per-recompute generation stamp on links, eliminating O(n²) behavior when a
  computation re-reads a dependency it already saw during the same pass
- Skip redundant subscriber walks when a signal is written multiple times in
  the same batch (epoch-invalidated by heap consumption, tracked-effect runs,
  or new subscribers)
- Reduce reconcile allocations: reuse the existing key array when key sets
  match in `getAllKeys`, and skip symbol lookups on primitive leaves in
  `unwrap`
- Avoid the `untrack` closure in `getKeys` for plain (non-proxy) sources
- Specialize `snapshotImpl`'s no-override walk to read each property once
- Cache one bound effect runner per effect instead of allocating per update
