---
"@solidjs/web": patch
"solid-js": patch
"@solidjs/signals": patch
---

Patch-mode list admission moves entirely to compile time: driveList engages only for row functions carrying the compiler's `rowProof` stamp (exported from @solidjs/web), and the runtime purity probe is deleted — no speculative execution of user row code, no probeMark/probeGate seams, no ownerIsBlank, no tentative empty-list engagement with late decline. Unstamped rows take the classic mapArray path before any DOM work; `lateClassic` remains only for engaged lists whose subject later leaves the contract (identity swap to a derived array, shallow/deep kind switch).
