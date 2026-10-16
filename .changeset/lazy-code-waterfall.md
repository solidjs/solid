---
"solid-js": patch
"@solidjs/signals": patch
---

`SSR_BOUNDARY_WATERFALL` now judges a wait by when its work started, the same origin rule the client's `ASYNC_WATERFALL` uses. A nested route meets its levels one render pass at a time, but the router starts every matched level's `lazy()` import and preload together. Before, the first request to a cold server warned about a data waterfall that wasn't there. A wait whose work had all started before the previous wait landed is now left out of the count (`data.parallelWaits`). `lazy()` and `lazyModule()` stamp their imports. The start stamps move from the attribution engine to the core's `OBSERVE.attribution` (`markFlight`, `flightOrigin`), so a router or cache can stamp what it hands out without loading the engine. `attribution.markFlight` writes to the same place.
