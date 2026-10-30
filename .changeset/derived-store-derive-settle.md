---
"@solidjs/signals": patch
---

`createStore(fn)`: a derive that went pending on a source and was settled without re-running (a staged rejection, or a re-ask that returned to the committed question) re-runs, so its readers settle: `isPending` ends and a refetch's rejection reaches them.
