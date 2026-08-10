---
"solid-js": patch
"@solidjs/web": patch
---

Shrink CSR bundles by moving the hydration-phase coordination seams (`sharedConfig.isHydrationInProgress` / `sharedConfig.onHydrationEnd`) out of the `sharedConfig` object literal and into `enableHydration()`, matching the null-slot pattern every other hydration hook already follows. Declaring them in the literal retained their bodies and the hydration-phase bookkeeping they close over (`_pendingBoundaries`, `_hydrationDone`, the callback list) in every client bundle; installed by `enableHydration()` they shake out of pure-CSR builds (≈100 B brotli on the CSR size scenario, ≈80 B on the minimal-app floor). Both fields were already typed optional and documented as cross-package internal wiring; consumers treat absence as "not hydrating" — the refresh runtime already optional-chains, and `clientOnly` now falls back to a bare `queueMicrotask`, which is byte-for-byte the behavior `onHydrationEnd` itself had outside hydration.
