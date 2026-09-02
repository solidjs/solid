---
"@solidjs/signals": patch
"@solidjs/babel-plugin-jsx": patch
"solid-js": patch
---

Deep-chain regions: the emitter now admits static-key member chains of any depth (`row.queries[0].elapsed`), subscribing a path witness per intermediate record from the region's compute — dk has no ancestor bubbling, so each step's witness covers the next key. The runtime `path` helper resolves through readSource (pending-backing aware: pure-phase computes run before commitPendingNodes, so `t.v` resolution would re-subscribe outgoing children on every replacement delivery), materializes targets for not-yet-wrapped children like deepNext's walk, and degrades to a tracked per-key proxy read in the classic fallback. The unchanged classic dbmon fixture now compiles to regions and roughly halves every dbmon metric (tick 12.7→6.3ms, mount 32.7→18.9ms vs classic).
