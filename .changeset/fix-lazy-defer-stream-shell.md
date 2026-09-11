---
"solid-js": patch
"@solidjs/web": patch
---

Fix `deferStream` being a silent no-op inside a code-split `lazy()` component (#3299). A module load is code, not data: the shell's "no new async discovered during the sync render" rule cannot be evaluated for a segment whose code has not run, so the shell now waits for the chunk even under a `<Loading>` (the boundary still owns the data the loaded code discovers — plain async streams behind the fallback as before, and a `deferStream` read inside the chunk holds the shell exactly like one in an eagerly imported component). Only the first render that reaches an un-preloaded chunk pays; a lazy mounted by a post-shell fragment streams as before.

Also closes a gap in the flush loop where a shell blocker registered while a boundary resumed during the drain — after the awaited set had settled but before the flush attempt snapshotted it — was never re-awaited.

`dynamic()` keeps streaming its source by default (a source is data of unknown cost) and gains a `deferStream` option to opt into holding the shell on it, with the same meaning as `createMemo`'s.
