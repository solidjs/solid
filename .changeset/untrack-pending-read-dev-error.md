---
"@solidjs/signals": patch
---

Dev: in a component body, a plain `untrack(fn)` that reads a pending async memo created in that same body now throws `PENDING_ASYNC_UNTRACKED_READ`, as a direct read does. Before, `untrack` cleared the check: the read threw `NotReadyError` to `<Loading>`, which re-ran the body onto a fresh pending memo forever, and the page froze. An untracked read of a memo created outside the body still reaches the boundary (D-23), sync untracked reads stay quiet, and `untrack(fn, false)` opts out. Production is unchanged.
