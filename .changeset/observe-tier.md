---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
"@solidjs/universal": patch
"@solidjs/diagnostics": patch
---

Observe tier: split dev-only checks from production-legal observability wiring.

**Breaking (pre-release):** `DEV.diagnostics` moved to a new `OBSERVE` export
— `OBSERVE.diagnostics.{subscribe,capture,emit}`, `OBSERVE.subjectOf(event)`.
`DEV` keeps the devtools surface (`hooks`, `getChildren`/`getSignals`/
`getParent`/`getSources`/`getObservers`) and gains the console face
(`DEV.report`, `DEV.setConsoleFooter` — formerly
`DEV.diagnostics.setConsoleFooter`). Both are exported from `@solidjs/signals`
and `solid-js` (client and server).

**Breaking (pre-release):** the attribution engine is its own entry.
`DEV.attribution.enable()` and friends are now
`import { attribution } from "solid-js/attribution"` (or
`@solidjs/signals/attribution`) — `enable/disable/subscribe/history/why/
subscriptions/costs/waterfalls/holds/feedback/markFlight/format/formatOrigin`,
plus the record types (`RerunEvent`, `ChangeRecord`, `ChangeOrigin`,
`HoldEvent`, …) which were previously unexported. The runtime keeps only the
core's side as `OBSERVE.attribution`: `install(hooks)`/`installed` (the hook
slot an engine — built-in or a devtools' own — installs into) and
`withInteraction(ref, fn)` (the frame the web runtime opens around every event
dispatch; `fn()` when no engine is installed). A build that never imports the
engine never ships it: the observe tier costs ~1.3 KB brotli over prod on the
CSR scenario, the engine 9.7 KB more when enabled. The import is legal in
every tier — prod resolves an inert engine with the same surface.
`@solidjs/diagnostics` requires `OBSERVE` and imports the engine itself; it now
works against observe builds.

**New build tier.** Every package with wiring ships `<entry>.observe.{js,cjs}`
beside its prod and dev artifacts, selected by a new `observe` export condition
(listed after `development`, so dev still wins when both are set): signals
`dist/observe/` + `dist/node.observe.cjs` (each with an `attribution` entry
beside `index`; the flat dev/CJS builds are code-split so both entries share
one module instance), solid-js `solid.observe.*` and
`server.observe.*`, web `web.observe.*`, universal `universal.observe.*`.
Observe builds keep attribution hook sites, owner labels (`_name`, flow-control
memo names, component roots), graph edge counters and the diagnostics channel;
they fold out strict-read checks, invariants, forbidden-scope guards, devtools
brands and all console output. Entries without wiring (frames, server-functions,
storage, h, html, element) fall through to prod under `observe`. Signals gates
on `__OBSERVE__` (dev implies observe; asserted at init), solid-js/web/universal
on the `"_SOLID_OBSERVE_"` literal. Default prod artifacts are unchanged apart
from the new `OBSERVE = undefined` export; `_name` is reserved from property
mangling so the cross-package label survives in the observe tree.
`OBSERVE.diagnostics.emit` accepts an explicit `ownerPath` for hosts whose
owners are not signals' owners (the SSR runtime).
