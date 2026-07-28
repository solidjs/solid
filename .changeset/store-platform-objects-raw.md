---
"@solidjs/signals": patch
---

Platform objects (Map, Set, Date, URL, DOM nodes, and other natives/host objects) are no longer wrapped by stores (#2952). Native code brand-checks internal slots and throws when invoked through a proxy (`store.map.size`, draft `s.map.set(...)` — "called on incompatible receiver"), so they can't honestly be stores. `isWrappable` now excludes them structurally via the tag check (`[object Object]` vs `[object Map]`, ...), giving them the markRaw-children contract automatically: served raw, mutations land on the raw object, and the property holding them still tracks so reassignment notifies. User class instances (which stringify as `[object Object]`) keep wrapping — getters and draft methods stay fully reactive. The hot path is unchanged perf-wise: plain/null-proto objects resolve on one `getPrototypeOf`, and the custom-proto verdict is memoized per prototype.
