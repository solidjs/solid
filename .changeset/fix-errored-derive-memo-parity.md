---
"@solidjs/signals": patch
---

An errored derived-store/projection derive now follows async memo rules for every reader. Previously the rejection only reached subscribers that existed at settle time: any later reader — fresh tracked or untracked — silently got node values instead (the seed while uninitialized, last-good data after a failed refetch). Late readers now throw the derive's error, and a genuine tracked re-read on a later cycle retries the derive exactly like an errored async memo (never for untracked reads or `isPending` probes, once per cycle).
