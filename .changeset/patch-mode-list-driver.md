---
"@solidjs/signals": minor
"solid-js": minor
"@solidjs/web": minor
---

Patch-mode list driver: keyed `<For>` over a store array is offered to the
runtime's row-ops driver (create/bind at op-apply, LIS moves, node removal —
no mapArray, no per-row owners, no DOM-side reconcile). `For` carries `$ll`
metadata on a lazy classic accessor so unaware renderers and declined lists
(non-store subject, impure rows proven by a bind-time owner probe, fallback
or index usage) fall through to today's mapArray path unchanged. Array
identity swaps keep keyed semantics by raw-identity matching. Adds
`ownerIsBlank` (signals) for the purity probe and `driveList` (web, rxcore
seam) for the runtime.
