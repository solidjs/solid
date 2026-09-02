---
"@solidjs/compiler": patch
"@solidjs/babel-plugin-jsx": patch
"solid-js": patch
"@solidjs/universal": patch
---

Region-delivery branch: remove patch-mode compilation — the `patchDriver` option (config, loader, types), the `wrapPatchMode` body emitter, row-proof purity stamping (`rowProof` wrapping, function-shape capture), the patch eligibility analysis module, and the `dom-patch` parity mode with its expectations. Graph-native regions replace the channel; the driver branch remains the independent comparison with the full grammar.
