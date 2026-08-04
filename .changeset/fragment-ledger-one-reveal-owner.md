---
"solid-js": patch
"@solidjs/web": patch
---

One reveal owner for streamed document fragments (DR-4): the hydration
runtime now keeps a fragment ledger — declarations are the serializer's
`<id>_fr` records, settlement is seroval's status marks, reveals are the
inline script's `_$HY.v` marks — published as `_$HY.fr` ({ pending,
subscribe }). The frames client's document adoption reads "may a boundary
still arrive" and learns of reveals from the ledger instead of scanning the
page for `pl-*` templates and monkey-patching `_$HY.fe`. The ledger also
detects truncation (#2958): a declaration still unsettled when the parser
finishes is marked rejected with a truncation error, releasing its boundary
through the normal rejection path instead of hanging on the fallback
forever, and letting document-adoption waiters give up and mount fresh.
