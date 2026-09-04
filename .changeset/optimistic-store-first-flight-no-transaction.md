---
"@solidjs/signals": patch
---

An optimistic store's first flight suspends into its Loading boundary again.
The flight-owned transaction (#3146) was declared for the uninitialized
first ask too, so every transition-riding consumer — `render()`'s scheduled
root insert included — was held until the initial fetch landed: the page
stayed blank (content outside the boundary included) and the boundary's
fallback never showed, while `createStore(fn, seed)` and
`createOptimistic(fn, seed)` in the same spot showed it. Nothing has
committed on a first flight, so there is no truth to keep on screen and no
optimistic state to protect: it now declares nothing, like the loading
window (#2933). Refetch flights declare exactly as before, so bare
optimistic writes during an in-flight refetch still ride the flight's
transaction (#2951) and content stays put until the new truth lands.
