---
"@solidjs/signals": patch
---

Two guesses on one optimistic store around another action's `refresh()`: a render effect waiting on that refresh (through a projection) now shows a new guess with the other readers of its slot (#4824), and a second guess on a slot no longer disappears when the first guess's action ends while the second is still out (#4825).
