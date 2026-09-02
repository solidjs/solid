---
"@solidjs/signals": patch
---

Region API consolidation: the prototype-era `trackRecordVersion`, `regionBind`, `createRegion`, and `deliveryEffect` exports are removed — `region()` is the single public entry (admission, tracked residuals, deep flag, durable demotion with classic-fallback rebind, amortized registry hygiene). Regions without residuals share one frozen tvals carrier instead of allocating per bind.
