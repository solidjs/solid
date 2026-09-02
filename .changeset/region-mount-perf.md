---
"@solidjs/signals": patch
"@solidjs/babel-plugin-jsx": patch
"solid-js": patch
---

Region mount-cost pass: admission scan uses own-descriptor probes (~30% cheaper than the prototype-walking `__lookupGetter__` pair); tracked residuals receive the compute-time raw as a second parameter so the emitter's direct depth-1 subject reads inside them (dynamic-key lookups) skip duplicate per-key subscriptions — the deep witness already wakes the compute. Region registry entries are now swept amortized on push (remount churn stays bounded; no per-mount cleanup registration), demotion skips dead entries, and trap-time demotion defers to the post-write notify so the classic fallback rebinds in a live graph instead of the draft context (where its subscriptions never tracked).
