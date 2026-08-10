---
"@solidjs/web": patch
---

The production server bundles build with `_DX_DEV_` replaced to false. The main server Rollup target (dist/server.js/.cjs — the only node/worker/deno artifact) was missing `replaceDev(false)`, and babel constant-folds the unreplaced truthy `"_DX_DEV_"` literal, so the shipped artifact permanently took the dev branch of every build-mode gate — most damaging the committed-stub header guard, which is spec'd to throw in dev but `console.error` + no-op in production: a post-commit header write from late async SSR work crashed a live production request instead of being reported and dropped (#2982). The frames server target had the same omission (dev-only useHead/insert warnings shipped in prod). Because the constant folding erases the `_DX_DEV_` marker whether or not the replace ran, the contract is pinned behaviorally by a new spec that imports the built dist/server.js directly, bypassing the suite's source aliasing.
