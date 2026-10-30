---
"@solidjs/signals": patch
---

A memo's error staged with a hold now reaches the memos and derived stores that derive from it: they re-run against it, so `latest()` of them throws the proposed error and `isPending()` of them is `true` until the hold commits, as for the memo itself (D-41). A memo or derived-store derive that catches the error answers with its own value instead, during the hold and after it: it no longer ends errored with an error its pass never threw, and a derived store's other keys keep their values (D-30).
