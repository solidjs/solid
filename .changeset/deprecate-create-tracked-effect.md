---
"@solidjs/signals": patch
"solid-js": patch
---

Mark `createTrackedEffect` as `@deprecated`. It is retained to ease 1.x migration, but it should not appear in new code: use `createEffect(compute, effect)` for side effects that follow reactive state (it separates tracking from the side effect, knows its dependencies before it runs, and participates in async and transitions) and `onSettled` for one-time DOM work after render. `onSettled` is unaffected (it uses the internal tracked-effect node directly).
