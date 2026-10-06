---
"@solidjs/web": patch
---

Dev diagnostics no longer warn about scopes the user cannot act on (#3739). `enablePerformanceTracks()` takes a records-only engine hold (`checks: false` unless `attribution: { checks: true }` is passed), so loading the tracks in every dev session no longer turns the cost checks (`hotRuns`, `hotTime`, `wideDeps`, `unstableMemos`, `fanOut`, `wastedRecompute`) on; another holder that asks for them still gets them. In dev, the `insert` child-resolution effect (which must track each row's resolved child, e.g. every `<Show>` row of a `<For>`) is exempt from `WIDE_SCOPE_DEPS`; `HUGE_FAN_IN` still covers it.
