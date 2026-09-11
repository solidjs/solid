---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/diagnostics": patch
---

`WIDE_WRITE` and `HOT_SCOPE_FANOUT` diagnostics, and the reactivity-diagnostics and agent-loops skills, now prescribe a projection (`createProjection`, or a `createStore(fn)` keyed by id) as the fan-out repair. They previously named an API that is not part of 2.0 (#3304).
