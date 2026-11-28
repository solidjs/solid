---
"@solidjs/signals": patch
"solid-js": patch
---

Production `createComponent` calls the component directly when nothing is tracking, instead of building an `untrack(() => Comp(props))` closure for every component. The new internal `untrackCall(fn, arg)` in `@solidjs/signals` falls back to `untrack` while a scope is tracking, in dev, and when an external untrack hook is installed. No behavior change.
