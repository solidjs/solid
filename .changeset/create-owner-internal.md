---
"solid-js": patch
"@solidjs/web": patch
---

`createOwner` leaves solid-js's public types: it is typed only through `solid-js/internal`, like the boundary primitives behind `Errored`, `Loading` and `Reveal` (#3709). It stays a runtime export for the renderers. Solid 1.x had no `createOwner`, and application code that used it in an RC should host a scope with `createRoot()` (its `dispose` argument can be passed around as a plain function) and re-enter one with `runWithOwner()`. A detached `owner.dispose` keeps throwing, since it is a method and not part of the public API (#4444).
