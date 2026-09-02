---
"@solidjs/signals": patch
"@solidjs/web": patch
"solid-js": patch
"@solidjs/universal": patch
"@solidjs/compiler": patch
"@solidjs/babel-plugin-jsx": patch
---

Remove the experimental patch channel and patch-mode list driver (always opt-in, never default). Graph-native regions own value delivery and the unified-For design owns list structure, so the channel's parallel delivery machinery is retired: `patch.ts`/`patch-driver.ts` deleted, the compiler-contract exports (`registerPatch`/`registerRowOps`/`registerSlotPatch`/`patchableRaw`, `patchDriver`/`rowProof`/`driveList`) removed, the `patchDriver` compiler option dropped from both compilers, the insert `$ll` seam stripped, and the write-side channel struct dieted to the single written-keys bound (`t.wk`) the core fold/notify paths actually use. Store-family app bundles reclaim up to ~900 B brotli; every measured tier shrinks.
