---
"@solidjs/signals": patch
---

Attribution cost checks judge only what the scope's author can act on (#3739). `WIDE_SCOPE_DEPS` no longer counts HMR plumbing sources (the `solid-js/refresh` memo per component instance), skips framework scopes marked with the new internal dev-only `_wide` option (`CONFIG_WIDE`; not public API), and its `wideDeps` default rises from 30 to 500. The engine-side `HUGE_FAN_OUT` (`fanOut`) no longer counts plumbing subscribers. The always-on `HUGE_FAN_IN` and core `HUGE_FAN_OUT` (2000) keep no exceptions.
