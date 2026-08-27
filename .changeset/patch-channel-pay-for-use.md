---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Patch channel is pay-for-use: the list driver and `patchDriver` moved out of the always-retained web runtime into `patch-driver.ts`, arming the insert seam lazily from `rowProof`/`patchDriver` (which only compiled patch-mode output imports); the store's emitters ride hooks installed at first registration (`patch-hooks.ts`) instead of static imports. Apps without patch-mode output retain only a ~100 B insert hook; the store write-path seams cost ~490 B on the store floor. Before this, every client app carried the full driver (~2.4 KB brotli).
