---
"@solidjs/signals": patch
---

An optimistic array guess no longer keeps serving another action's expired guess at indices it did not itself write (#4784). A guess's frame is composed on the view, so it holds the other guess's values at keys outside its own record; an arrangement read now falls through on those carried-over keys — to the lending carrier while it lives, to the truth once it dissolves — instead of serving the frame's stale copy. Writes that change no keys and no length already belonged to the changed indices (#4724); the read side now matches when the lending guess expires while a disjoint guess is still out.
