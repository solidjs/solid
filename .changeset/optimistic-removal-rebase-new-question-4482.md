---
"@solidjs/signals": patch
---

A keyed optimistic store's removal guess re-based over a new question's answer no longer shows the old list's rows beside the new ones (#4482). The re-base (D-35) kept every guessed row the new truth lacked, including the rows the guess had only carried over from the truth it was written on; it now composes the guess's own edit — the rows it added or carried from another action's guess, minus the rows it removed — over the new truth, and takes the rest from that truth (F-1).
