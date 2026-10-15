---
"solid-js": patch
---

Server `<For>` keeps its rows across live-hole sweeps (#4056). A markup hole that re-emits (a live server component, a standing source) re-evaluated every row of a list on every write. During a sweep, a row whose item at the same index is unchanged (the same reference, or a shallow-equal object, as a live source's fresh snapshot usually is) now reuses the row it rendered on the previous sweep. Plain SSR and a server component's first render are unchanged. A row is a function of its item: an item mutated in place keeps its old row, and a row that reads outside data keeps the value it rendered with.
