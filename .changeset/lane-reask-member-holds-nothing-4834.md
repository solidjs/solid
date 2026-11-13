---
"@solidjs/signals": patch
---

A guess lane is no longer held by a member that waits only on another action's `refresh()`: a memo over the shown guess and a fresh answer (a heading beside a list being re-asked) now shows the guess over the answer instead of its stale committed value (#4834).
