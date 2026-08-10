---
"@solidjs/signals": patch
"solid-js": patch
---

Size pass over the loading-window (loadingValue/seedLoadingValue) client code: the unready-source parking sequence dedupes into one shared `parkLoadingWindow` helper (used by recompute's catch and handleAsync's handleError), the repeated `instanceof NotReadyError` tests in recompute's catch hoist into one boolean, and the window-clear writes at landing points become unconditional stores. The hydration entry stops precomputing the window flag per wrapper — options thread through to `readHydratedValue`, which does the check at read time. Behavior unchanged. The signals size gates ratchet for the feature itself (core floor 7.1 -> 7.35 KB, isPending 8.75 -> 9 KB, measured 7.18 / 8.84): the window support rides always-retained memo paths by construction (it's an option, not an import), so its ~110 B brotli cannot tree-shake.
