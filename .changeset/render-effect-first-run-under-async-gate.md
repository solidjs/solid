---
"@solidjs/signals": patch
---

A render effect's first run goes through when its subtree mounts, whatever boundary above is still on its fallback in that flush (D-19). Under `<Loading> > <Show when={ready()}> > <Loading>`, a render effect in the inner content ran at once while the inner fallback showed when `ready` was a signal, but waited for the inner data when `ready` was an async memo settling: the outer boundary had not swapped to its content yet when the effect was created, and its first run was held like a queued one. Both gates now run it with the mount (#4343). User effects still wait for the reveal.
