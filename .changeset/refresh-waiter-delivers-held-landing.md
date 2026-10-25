---
"@solidjs/signals": patch
---

`await refresh(memo)` no longer hangs when the memo is held by an in-flight
action's transaction (#4263). After an optimistic write, a mainline change to
one of the memo's dependencies lands a new value into the action's hold; a
`refresh()` waiter created after that landing read the held node, was born
held, and waited for a commit the awaiting action could never produce. Under
a hold an action keeps open, the waiter now delivers the re-ask's landing
instead of parking until the commit, as it already did when it ran in the
landing's own flush. A plain pending frame still delivers at its commit, and
`until()` and `resolve()` keep their posture (#3482).
