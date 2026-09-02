---
"solid-js": patch
"@solidjs/web": patch
---

Unified For driver (spike): keyed `<For>` returns a callable carrying a `$for` descriptor; an armed web renderer (`enableUnifiedFor()`) owns rows and DOM placement in one persistent structure — intrusive row chain + incremental key map, prefix/suffix/LIS update pass in an ordinary two-phase render effect — bypassing both mapArray and reconcileArrays for engaged lists. Declines (hydration, keyed fns, duplicate keys, dynamic top-level rows, non-array subjects) land on the classic path; late demotion re-enters classic under the original owner. Off unless armed.
