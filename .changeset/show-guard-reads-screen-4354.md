---
"solid-js": patch
---

Non-keyed Show's narrowed accessor no longer throws a stale-value error when an on-screen branch re-runs during a hold that is closing it: the guard reads the condition as the reading binding sees it (the screen), as Match already does
