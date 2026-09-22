---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

`attribution.enable(opts)` now returns the release of the hold it takes (idempotent, like `subscribe`), and options layer per hold — the defaults with each live hold's options applied in hold order, recomputed when a hold releases — so a consumer that enabled with `log: false` beside a console session gives the log back when it leaves, instead of every call rebuilding the options from defaults. `disable()` is the full teardown whatever holds are outstanding (the console's reset), so re-enabling to reopen a window and calling `disable()` once cannot strand a hold. `enablePerformanceTracks` releases through the token and layers `log: false` only when it is the one installing the engine. Dev builds create a component's `console.createTask` task only for components rendered while an attribution engine is installed — the stack capture per call roughly doubled dev mount for a session with nothing enabled; the tracks enabled at bootstrap still see every component's site.
