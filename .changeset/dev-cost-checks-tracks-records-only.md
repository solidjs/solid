---
"@solidjs/web": patch
---

Performance tracks no longer run the attribution cost checks by default (#3739). `enablePerformanceTracks()` — which `@solidjs/vite-plugin` calls in every `vite dev` session — now takes a records-only engine hold, so the six cost checks (`hotRuns`, `hotTime`, `wideDeps`, `unstableMemos`, `fanOut`, `wastedRecompute`) are opt-in again. To turn them back on, pass `enablePerformanceTracks({ attribution: { checks: true } })` (or `performanceTracks: { attribution: { checks: true } }` in the vite plugin), or take your own `attribution.enable()` hold. In dev builds, the `insert` child-resolution effect (which must track each row's resolved child, e.g. every `<Show>` row of a `<For>`) is also exempt from `WIDE_SCOPE_DEPS`; `HUGE_FAN_IN` still covers it.
