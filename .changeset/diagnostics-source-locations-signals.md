---
"@solidjs/signals": patch
---

Diagnostics carry a source location. `NodeOptions.loc` and `StoreOptions.loc` (`file:line:col`, root-relative — written by the compiler's `sourceNames` `locations` kind, not by hand) land in a `_loc` slot beside `_name` on the observe/dev node literals; store property nodes carry their store's. `DiagnosticEvent.loc` is the innermost located node on the subject's chain (its own `loc`, else the first up the owners — a signal through its registering owner), found in `emitDiagnostic` the way `ownerPath` is; a host event that sets it keeps it. `reportDiagnostic` prints it as an `at` line after the `in` line — `at src/App.tsx:18:3`, or in a browser `at http://localhost:5173/src/App.tsx:18:3`, which the devtools link to the Sources panel. `DEV.guideUrl(code)` now returns the code's page on the docs site (`https://v2.solidjs.com/reference/solid-js/diagnostics/<slug>`).
