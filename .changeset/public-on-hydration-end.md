---
"solid-js": patch
---

`onHydrationEnd` is public API again, as `@experimental` (#4000), so end-to-end tests have a documented end-of-hydration signal instead of reading `_$HY` internals. It was already a runtime export of both entries; only its declarations change (it is no longer stripped as `@internal`), so it adds no runtime bytes. `sharedConfig` and `isHydrationInProgress` stay internal.

- `onHydrationEnd(callback)` (`solid-js`): runs `callback` once when the hydration phase ends — the root pass of `hydrate()` over and every streamed `<Loading>` boundary (and every hold an integration registers) resumed or cancelled. With no hydration in progress, and on the server, it runs in the next microtask.
- Register it after calling `hydrate()`: registered before hydration starts (or after a `hydrate()` parked mid-parse, #3971), it runs in the next microtask and does not wait for hydration work started afterward.
- It reports that the phase ended, not that hydration succeeded: a document root whose module preload fails ends the phase with the server markup kept and not interactive.
- It is not page-wide completion with several hydration roots: a root deferred behind its module preload is not counted (GH5).
- Intended for test tooling and markers, not for branching what the app renders.

This reverses the part of the earlier "Remove isHydrating/onHydrationEnd from public API" entry that covered `onHydrationEnd`, as #3718 did for `isHydrating`: hydration snapshots make timing transparent to code inside the app, not to a test reading the page from outside it.
