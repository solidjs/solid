---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/signals": patch
---

`sharedConfig` and `$DEVCOMP` are no longer part of `solid-js`'s public types; they are typed from `solid-js/internal` (not public API, no semver guarantee). Their runtime exports from `solid-js` are unchanged. Libraries that import `sharedConfig` from `solid-js` must switch to `solid-js/internal`. Under `skipLibCheck: false`, `solid-js`'s declarations now type-check clean (they re-exported both names after stripping them, #3709). The `REACTIVITY_HALTED` message now points to `<Errored>` only.
