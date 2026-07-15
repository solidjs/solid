---
"@solidjs/signals": patch
"solid-js": patch
---

Pay-for-use tree-shaking, phase 2 (#2883). The optimistic write engine (override writes, lane routing/suspension, stashed-optimistic reads, transition-completion blockage, optimistic-node resolution) moves out of `core.ts`/`scheduler.ts`/`lanes.ts` into a new internal `optimistic` module behind fourteen nullable `GlobalQueue` hooks, installed by the verdict layer and at first `createOptimistic`/`createOptimisticStore` call. Every core call site is gated on state only the engine can create (an `_overrideValue` slot, a live lane, a non-empty optimistic batch), and the A17 override-is-the-value read path stays inline in core. On the `solid-js` side, `createLoadingBoundary`'s hydration-resume machinery (boundary triggers, resume scheduling, asset-failure reporting, snapshot capture) now installs through the existing `enableHydration()` seam, so client-only apps stop shipping it.

Measured (esbuild, minify, `_`-prop mangling, gzip -9): core floor 8.2 → 7.7 KB gzip; plain-store subset 13.0 → 12.4 KB; minimal app from published dist 11.5 → 10.9 KB; a CSR app using `<Loading>` drops a further ~0.9 KB gzip; opting into `hydrate()` costs +43 min bytes. Cumulative with phase 1, the minimal-app floor is down ~14% and the signals floor ~13.5% with no behavioral change — differential smoke runs are byte-identical and the full Tier-A suite passes unchanged.
