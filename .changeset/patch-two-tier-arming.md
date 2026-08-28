---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Patch-channel arming is two-tier so the default-on cost stays proportional: `patchDriver` no longer retains the list driver (only `rowProof` — the compiled marker of a patch-mode list — arms the insert seam), and the store emitters split into value hooks (armed by `registerPatch`) and row hooks (armed by list registrations), so non-list patch templates never retain row binding, LIS, or reconcile's diff builders. Flip-preview size scenarios pin both tiers.
