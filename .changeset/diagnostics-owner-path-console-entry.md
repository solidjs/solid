---
"@solidjs/signals": patch
"solid-js": patch
---

Diagnostics locate themselves and report once.

- Every `DiagnosticEvent` now carries `ownerPath` — the root-first chain of named owners enclosing the subject (`["<App>", "<TodoRow>", "effect"]`). Component roots are labeled `<Name>` by `solid-js`'s dev component wrapper, so the path reads as the component tree down to the scope; owned-scope write errors in a component body now say `(in <TodoRow>)`.
- Console reports are a single entry per finding: message, an `in <App> › <TodoRow> › effect` line, and the once-per-code repair footer as trailing lines — the footer no longer lands as a separate, duplicate-looking `[CODE]` line. Advisory (`info`) events emit no footer at all.
- `ASYNC_OUTSIDE_LOADING_BOUNDARY` fires once per `render()` instead of once per pending render effect (N async siblings at mount produced N copies).
- New dev-only helpers on the signals core: `reportDiagnostic(entry)` (the console face) and `ownerPath(subject)`; `emitDiagnostic` takes an optional subject (defaulting to the ambient reactive context).
