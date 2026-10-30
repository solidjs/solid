---
"@solidjs/signals": patch
---

`createStore(fn)`: a derive that went pending on a source and was settled without re-running (a staged rejection, or a re-ask that returned to the committed question) settles its readers with it, as a memo's would: `isPending` ends and a refetch's rejection reaches them.
