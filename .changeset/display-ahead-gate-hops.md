---
"@solidjs/signals": patch
---

A display-ahead gate is the same mainline mount with any number of memos between the probe and the branch (S-58, D-25). A hand-written gate — one memo that probes and mounts, or a truthiness memo with a branch memo reading it — now keeps its fallback through the flight and attaches at the landing, as `<Show>` and the compiled ternary do: a probe's held reader whose frame holds a born-held mount is no longer published with its hole empty when the probe re-derives to the same value at the seam, and a mount under an open action counts as still waiting. The plain read under an errored boundary inside an action (S-53′) attaches at the landing with it.
