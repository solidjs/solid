---
"@solidjs/signals": patch
---

A new async memo created over a held update now waits for it (#3800). A memo created while a transition holds a value, whose first pass reads that value and returns a promise, lands its first answer into the transition and reveals at its commit, as the same memo with a synchronous first answer already did. Before, the promise landed on its own and its readers showed the new value beside the rest of the page still on the old one. The transition never waits for the new memo's first load: if it lands after the transition commits, it is its own commit.
