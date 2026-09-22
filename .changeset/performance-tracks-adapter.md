---
"@solidjs/web": patch
"solid-js": patch
---

`@solidjs/web/performance-tracks`: Solid's records on the Chrome Performance panel

`enablePerformanceTracks(options?)` paints the attribution engine's records — re-runs (`Effects`/`Memos`, coloured by self time, `warning` for a provably wasted run), interactions (input delay, handler, settle by outcome), holds (`warning` for a silent hold, `error` for a long one — the engine's own verdicts), navigations (named by route) — and the web runtime's server-function `call` and `frame` records (`Server`) as custom tracks in the group `Solid`, through the panel's extensibility API. Every span is emitted retroactively from the record's own `performance.now()` stamps; labels come from the shared formatters (`formatOrigin`, `formatRerun`, `ownerPath`), so the timeline agrees with the diagnostics artifact by construction. Dev builds emit `performance.measure` entries with `detail.devtools` (why-chain tooltips, cause/deps/blocker properties; entries cleared in batches); observe builds emit `console.timeStamp` spans with a `0.05ms` floor and scrub value previews and non-button element text. Prod builds fold the module to a no-op. Options: `attribution` (the engine hold's options; `log: false` is layered only when the adapter is what installs the engine), `minMs`, `rich`, `group`, `scrub`. Returns the release of this adapter's hold — the engine's and its own.

`solid-js` now exports `ownerPath` (already public on `@solidjs/signals`) — the root-first owner labels of a subject — on both the client and server entries, so in-process consumers of the records (this adapter) can label a re-run by its component path without importing signals directly.
