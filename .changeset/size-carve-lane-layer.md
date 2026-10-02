---
"@solidjs/signals": patch
---

Size audit (measurement branch): carve the lane layer — `createOptimistic`'s write, `isPending`, `latest` — ahead of its rebuild from the §28 principles (`documentation/plans/size-reduction-carve-step1.md`). The layer measured 1775 B br on `+ isPending/latest` and 1809 B br on the live page as built.
