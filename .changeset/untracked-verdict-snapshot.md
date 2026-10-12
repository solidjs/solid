---
"@solidjs/signals": patch
---

An untracked `isPending` or `latest` inside a computation is a snapshot: it no longer makes the computation re-run when one of its own dependencies goes pending. A router link claim that probes pending state while its anchor is created no longer rebuilds the `<Show>` around it on every refetch of its condition (#3946). Event handlers are unchanged, and a throw from an unresolved source still reaches the computation through `untrack`.
