---
"@solidjs/signals": patch
---

A node created over a hold now waits for it: an async first load that read a held value and lands while that hold is still live is staged into it and revealed at its commit, instead of publishing the held value early (#3800). The hold still never waits for the new node's first load; one that lands after the hold commits is its own commit.
