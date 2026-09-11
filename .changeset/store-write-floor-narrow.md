---
"@solidjs/signals": patch
---

Store writes on narrow containers are ~1.85× cheaper (629 → 340 ns per write+commit steady state; a fresh store's first write+commit 3× cheaper). Plain-data containers now clone by spread instead of a descriptor walk, and the #3044 prototype overlay is taken only for wide (>32 own keys) containers over an already-owned backing — for narrow or unowned ones the overlay cost more than the clone it was meant to avoid (`Object.create` turns the backing into a V8 prototype, and the first commit had to privatize-clone anyway). Part one of #3360; the remaining per-write cost is the weak-collection registration of each pending backing.
