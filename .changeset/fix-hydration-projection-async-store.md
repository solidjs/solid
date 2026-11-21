---
"solid-js": patch
---

Stop serializing synchronous `createProjection` / `createOptimisticStore` derives that only waited on a pending async source during SSR, so hydrated projections run live against their hydrated source and follow subsequent writes (#5146).
