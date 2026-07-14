---
"@solidjs/signals": patch
---

Make `affects()` and `isPending()`/`latest()` pay-for-use (#2883, phase 1). The affects mark engine and sentinel propagation move out of `async.ts`/`scheduler.ts` into the `affects` feature module, and the whole isPending/latest verdict layer (probe, companions, re-ask classification, the `latest()` read path) moves to a new internal `verdict` module; both install nullable `GlobalQueue` hooks on import, so bundles that never import these APIs never ship their machinery. The published dist is now a per-module tree (`dist/dev/`, `dist/prod/`, `dist/node/`) instead of one flat file — statement-level tree-shaking can never drop a flat file's top-level hook installs, so the split is what makes the hooks pay off for npm consumers. `_`-prefixed property mangling runs as a single sequential pass with one shared name cache per tree, keeping mangled names consistent across module files.

Measured on a minimal app (render + one signal) bundled from the published dist: 12.7 → 11.4 KB gzip. Core-primitives floor from src: 8.9 → 8.2 KB gzip. Apps importing every feature pay ~0.7 KB min of hook shims. A new `treeshake` test guards the retained-module graph and the floor's byte ceiling so re-coupling fails CI.

No public API changes: `createStore`'s derived overload intentionally keeps its static projection/reconcile coupling, and promise-returning computeds remain handled by core in every build — the appearance of a promise is the trigger, not an import.
