---
"@solidjs/signals": patch
---

`isPending(a)` inside a memo — including a `<Show when={isPending(a)}>` outside any `<Loading>` boundary — now reports true while an async memo derived from `a` is refetching (#3028). The wrapper memo recomputes during the write's flush and reads the held value fresh, which the fresh-read pairing rule (#2831) treated as "this reader already sees the answer" and silenced the verdict; with the downstream async not yet registered, nothing ever re-asked, so the indicator never showed. The pairing rule now only silences landed answers awaiting reveal — a held input whose transaction still has async in flight stays pending for every reader — and a probe that was silenced before the async registered is re-woken at the registration site, flushing the corrected verdict immediately.
