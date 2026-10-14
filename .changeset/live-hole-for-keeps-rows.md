---
"solid-js": patch
---

Server `<For>` keeps its rows across live-hole sweeps (#4056). A markup hole that re-emits (a live server component, a standing source) re-evaluated every row of a list on every write. During a sweep, a row whose item is the same reference at the same index now reuses the row it rendered on the previous sweep, as the client's `For` does. Plain SSR and a server component's first render are unchanged. As on the client, a row is a function of its item: an item mutated in place keeps its old row.
