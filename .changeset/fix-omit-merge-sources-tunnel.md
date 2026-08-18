---
"@solidjs/signals": patch
---

omit() no longer forwards the internal merge-sources probe, so re-merging an omit() of a merge proxy keeps the omitted keys hidden (#3014). merge() flattens nested merges by reading a hidden $SOURCES key off each source; omit()'s forwarding proxy tunneled that read through to the underlying merge proxy's unfiltered source list, so any path that re-merges the rest object — the compilers' element-spread handling on BOTH the SSR side (omitted props leaked into the HTML as attributes) and the client side (an omitted component-protocol handler like onChange re-bound as a native listener and fired with the raw Event) — bypassed the filter. omit proxies are now opaque to source flattening and compose through their traps, which filter correctly.
