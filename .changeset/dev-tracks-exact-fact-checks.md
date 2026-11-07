---
"@solidjs/web": patch
---

In dev builds the performance tracks' engine hold now runs the two cost checks whose findings are exact facts with an exact fix: `UNSTABLE_MEMO_OUTPUT` (a memo that keeps returning a new-but-equivalent value) and `WASTED_RECOMPUTE` (a scope whose runs keep producing the value it already had). Since `@solidjs/vite-plugin` loads the tracks in every dev session, these now reach the console without a diagnostics capture or a manual `attribution.enable()`. The heuristic checks (`hotRuns`, `hotTime`, `wideDeps`, `fanOut`) stay off, as #3739 decided: they fire on ordinary list fan-in. Observe builds are still records only. An explicit `checks` in the tracks' `attribution` option is honored as before (`true` runs all of them, `false` none).
