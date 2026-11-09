---
"solid-js": patch
---

A stream cut short no longer hangs hydration when the client runtime starts after the parser finished (#2958). The truncation sweep only armed when `hydrate()` ran while `document.readyState` was still `"loading"`. An entry that ran later, such as one waiting on a route module that arrives after `DOMContentLoaded`, or a deferred module entry, left every unsettled `_fr` declaration pending, so its `<Loading>` kept the fallback and hydration never ended. When the document carries the in-render bootstrap (`<HydrationScript />`, which declares `_$HY.s`), a runtime that boots after parsing now runs the same sweep at boot: the records that can no longer settle leave the registry, the cut fragments are rejected, and a macrotask later the refs a keyed consumer already took are rejected. Documents with a host-placed bootstrap (`generateHydrationScript()`) are unchanged.
