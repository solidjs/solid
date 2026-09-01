---
"@solidjs/signals": patch
"@solidjs/web": patch
"solid-js": patch
---

Region-delivery branch: gut the patch channel and list driver — `patch.ts` and `patch-driver.ts` deleted, the compiler-contract exports (registerPatch/registerRowOps/registerSlotPatch/patchableRaw, patchDriver/rowProof/driveList) removed, the insert seam stripped, and the emission hook seams reduced to typed null constants so every guarded write-path site compiles unchanged and dies at minification. Store-app bundles land 230–260 B under the pre-gut budgets; graph-native regions are the replacement delivery mechanism.
