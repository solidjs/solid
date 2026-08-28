---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Fifth-round hardening of the patch channel: no-op adoptions (A→B→A in one batch) clear the adopted flag so later setter row ops never freeze a driven list; transition merges retarget the moved entries' coalescing stamps (post-merge emissions coalesce instead of double-applying at commit); multi-consumer patch dispatch snapshots the registration list (a callback unbinding a sibling no longer skips consumers); the list driver's initial construction severs partial registrations on throw like update-time builds (one failed initial render no longer elevates patchCount globally); a failed apply actively resyncs from the next slot tick instead of waiting for a structural update; and identity swaps register the new subject's channels before applying so a throwing swap stays recoverable.
