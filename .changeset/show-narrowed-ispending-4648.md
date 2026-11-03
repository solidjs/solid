---
"solid-js": patch
"@solidjs/signals": patch
---

A non-keyed `<Show>`'s or `<Match>`'s narrowed accessor read inside an `isPending()` thunk no longer throws the stale-value error for a branch that mounted in the flush its condition landed in, so the thunk's later reads link and the verdict flips (#4648). The exemption holds only inside a verdict window (`isPending` / `latest`): a plain read of the accessor while its branch's opening is held still throws, rather than hand out the committed falsy.
