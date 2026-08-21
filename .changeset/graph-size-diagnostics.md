---
"@solidjs/signals": patch
---

Always-on dev diagnostics for reactive-graph size: HUGE_FAN_OUT warns when one source reaches 2000 live subscribers (the every-row-reads-selectedId signature — prefer a per-key store or projection) and HUGE_FAN_IN when one computation reaches 2000 live sources (the coarse-read signature). Counts are maintained on link/unlink so disposed edges never count; repeats every 500 past the threshold; zero production cost.
