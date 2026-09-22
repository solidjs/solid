---
"@solidjs/web": patch
"@solidjs/signals": patch
---

`@solidjs/web/performance-tracks`: one instance per page — a second `enablePerformanceTracks()` joins the running one and returns its own release (HMR re-evaluation no longer paints every span twice or strands a hold); the `./performance-tracks` export resolves to the inert artifact under the `node`/`worker`/`deno` conditions so an SSR pass takes no engine hold and emits nothing; host `performance`/`console` calls are guarded so a throw drops the entry instead of propagating into the engine's record loop; `rich: false` falls back to `performance.measure` where `console.timeStamp` is missing; rich mode clears only the User Timing names it owns outright, leaving an app measure that shares a label alone. Engine: fallbacks staged on a transaction are held weakly, so a transaction dropped without settling releases them.
