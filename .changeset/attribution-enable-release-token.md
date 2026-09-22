---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

`attribution.enable(opts)` now returns the release of the hold it takes (idempotent, like `subscribe`), and options combine across holds by the most demanding request per key (the log prints while any holder wants it, a check runs while any holder wants it at the most sensitive threshold asked for, `historyLimit` is the largest), so a hold adds to what the engine does and never takes away what another asked for — a track enabled with `log: false` beside a console session leaves its log alone, in either order — instead of every call rebuilding the options from defaults. `disable()` is the full teardown whatever holds are outstanding (the console's reset), so re-enabling to reopen a window and calling `disable()` once cannot strand a hold. `enablePerformanceTracks` releases through the token. Dev builds create a component's `console.createTask` task only for components rendered while an attribution engine is installed — the stack capture per call roughly doubled dev mount for a session with nothing enabled; the tracks enabled at bootstrap still see every component's site.
