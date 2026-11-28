---
"@solidjs/signals": patch
---

A guess written by an action that a cleanup calls no longer leaks into an unrelated action. Before, an unrelated action that was waiting showed the guess (#5239). Such a guess now belongs to the cleanup's action. It is dropped when that action holds nothing. It shows while that action waits, including on async work its own writes start, and reverts when it lands.
